package app.angelanexus

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import org.json.JSONArray
import org.json.JSONObject

class HttpCoreRuntimeTransport(
    endpoint: URI,
    private val connectTimeoutMs: Int = 1500,
    private val readTimeoutMs: Int = 5000,
    private val connectionFactory: (URI) -> HttpURLConnection = { uri ->
        uri.toURL().openConnection() as HttpURLConnection
    },
) : CoreRuntimeTransport {
    private val importEndpoint = endpoint.resolve("v1/runtime/import")

    init {
        require(importEndpoint.scheme == "http" || importEndpoint.scheme == "https") {
            "Core runtime endpoint must use HTTP or HTTPS"
        }
        require(connectTimeoutMs > 0) { "connect timeout must be positive" }
        require(readTimeoutMs > 0) { "read timeout must be positive" }
    }

    override suspend fun sendConfigurationImport(payload: String): CoreRuntimeImportResult {
        require(payload.isNotEmpty()) { "configuration import payload must not be empty" }

        val connection = connectionFactory(importEndpoint)
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = connectTimeoutMs
            connection.readTimeout = readTimeoutMs
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("Accept", "application/json")

            connection.outputStream.use { output ->
                output.write(payload.toByteArray(Charsets.UTF_8))
            }

            val status = connection.responseCode
            val responseBody = runCatching {
                connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            }.getOrElse { "" }

            if (status !in 200..299) {
                throw IOException(
                    "Core runtime rejected configuration import: HTTP $status" +
                        responseBody.takeIf { it.isNotBlank() }?.let { ": $it" }.orEmpty(),
                )
            }

            return CoreRuntimeImportResultParser.parse(responseBody)
        } finally {
            connection.disconnect()
        }
    }
}

internal object CoreRuntimeImportResultParser {
    fun parse(body: String): CoreRuntimeImportResult {
        val root = runCatching { JSONObject(body) }
            .getOrElse { throw IllegalArgumentException("Core runtime returned invalid JSON", it) }
        require(root.optBoolean("ok", false)) {
            "Core runtime returned an invalid success response"
        }
        val result = root.optJSONObject("result")
            ?: throw IllegalArgumentException("Core runtime response is missing result")
        val nodeCount = result.optInt("nodeCount", -1)
        require(nodeCount >= 0) { "Core runtime returned a negative nodeCount" }
        val (nodeSummaries, nodeSummariesTruncated) = parseNodeSummaries(result, nodeCount)

        return CoreRuntimeImportResult(
            source = result.optionalString("source"),
            nodeCount = nodeCount,
            kernel = result.optionalString("kernel"),
            detectionConfidence = result.optionalString("detectionConfidence"),
            configuration = result.optionalString("configuration"),
            executionIntentJson = optionalJson(result, "executionIntent")
                ?: optionalJson(result, "executionIntentJson"),
            nodeSummaries = nodeSummaries,
            nodeSummariesTruncated = nodeSummariesTruncated,
        )
    }

    private fun parseNodeSummaries(
        result: JSONObject,
        nodeCount: Int,
    ): Pair<List<CoreNodeSummary>, Boolean> {
        val array = when {
            !result.has("nodeSummaries") || result.isNull("nodeSummaries") -> null
            else -> result.optJSONArray("nodeSummaries")
                ?: throw IllegalArgumentException("Core runtime returned invalid node summaries")
        }
        val truncated = if (result.has("nodeSummariesTruncated")) {
            result.get("nodeSummariesTruncated") as? Boolean
                ?: throw IllegalArgumentException("Core runtime returned an invalid node summary truncation marker")
        } else {
            false
        }
        if (array == null) {
            require(!truncated) { "Core runtime marked missing node summaries as truncated" }
            return emptyList<CoreNodeSummary>() to false
        }

        require(array.length() <= MAX_NODE_SUMMARIES) { "Core runtime returned too many node summaries" }
        val summaries = (0 until array.length()).map { index ->
            val node = array.optJSONObject(index)
                ?: throw IllegalArgumentException("Core runtime returned an invalid node summary at index $index")
            val keys = mutableSetOf<String>()
            val iterator = node.keys()
            while (iterator.hasNext()) keys += iterator.next()
            require(keys == NODE_SUMMARY_FIELDS) { "Core runtime returned unexpected node summary fields" }

            val name = node.requiredBoundedString("name", MAX_NODE_NAME_CHARS)
            val protocol = node.optionalBoundedString("protocol", MAX_NODE_PROTOCOL_CHARS)
            val server = node.optionalBoundedString("server", MAX_NODE_SERVER_CHARS)
            val port = if (node.isNull("port")) {
                null
            } else {
                val raw = node.get("port") as? Number
                    ?: throw IllegalArgumentException("Core runtime returned an invalid node port")
                val numeric = raw.toDouble()
                require(numeric % 1.0 == 0.0 && numeric in 1.0..65535.0) {
                    "Core runtime returned an invalid node port"
                }
                numeric.toInt()
            }
            CoreNodeSummary(name, protocol, server, port)
        }

        require(nodeCount >= summaries.size) { "Core runtime returned more summaries than nodes" }
        if (truncated) {
            require(summaries.size == MAX_NODE_SUMMARIES && nodeCount > summaries.size) {
                "Core runtime returned an inconsistent node summary truncation marker"
            }
        } else if (result.has("nodeSummaries")) {
            require(nodeCount == summaries.size) { "Core runtime returned an incomplete node summary without a truncation marker" }
        }
        return summaries to truncated
    }

    private fun JSONObject.optionalString(key: String): String? =
        if (!has(key) || isNull(key)) null else getString(key)

    private fun JSONObject.requiredBoundedString(key: String, maxChars: Int): String {
        val value = get(key) as? String
            ?: throw IllegalArgumentException("Core runtime returned an invalid node summary field '$key'")
        val normalized = value.trim()
        require(normalized.isNotEmpty() && normalized.length <= maxChars) {
            "Core runtime returned an invalid node summary field '$key'"
        }
        return normalized
    }

    private fun JSONObject.optionalBoundedString(key: String, maxChars: Int): String? {
        if (!has(key) || isNull(key)) return null
        return requiredBoundedString(key, maxChars)
    }

    private fun optionalJson(result: JSONObject, key: String): String? {
        if (!result.has(key) || result.isNull(key)) return null
        return when (val value = result.get(key)) {
            is JSONObject, is JSONArray -> value.toString()
            is String -> value.takeIf { it.isNotBlank() }
            else -> throw IllegalArgumentException("Core runtime response field '$key' is not valid JSON")
        }
    }

    private const val MAX_NODE_SUMMARIES = 100
    private const val MAX_NODE_NAME_CHARS = 160
    private const val MAX_NODE_PROTOCOL_CHARS = 48
    private const val MAX_NODE_SERVER_CHARS = 253
    private val NODE_SUMMARY_FIELDS = setOf("name", "protocol", "server", "port")
}
