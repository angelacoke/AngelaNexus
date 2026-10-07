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

        return CoreRuntimeImportResult(
            source = result.optionalString("source"),
            nodeCount = nodeCount,
            kernel = result.optionalString("kernel"),
            detectionConfidence = result.optionalString("detectionConfidence"),
            executionIntentJson = optionalJson(result, "executionIntent")
                ?: optionalJson(result, "executionIntentJson"),
        )
    }

    private fun JSONObject.optionalString(key: String): String? =
        if (!has(key) || isNull(key)) null else getString(key)

    private fun optionalJson(result: JSONObject, key: String): String? {
        if (!result.has(key) || result.isNull(key)) return null
        return when (val value = result.get(key)) {
            is JSONObject, is JSONArray -> value.toString()
            is String -> value.takeIf { it.isNotBlank() }
            else -> throw IllegalArgumentException("Core runtime response field '$key' is not valid JSON")
        }
    }
}
