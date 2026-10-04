package app.angelanexus

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI

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
    private val okPattern = Regex(""""ok"s*:s*true""")
    private val sourcePattern = Regex(""""source"s*:s*"((?:\.|[^"\])*)"""")
    private val nodeCountPattern = Regex(""""nodeCount"s*:s*(d+)""")
    private val kernelPattern = Regex(""""kernel"s*:s*"((?:\.|[^"\])*)"""")
    private val confidencePattern = Regex(""""detectionConfidence"s*:s*"((?:\.|[^"\])*)"""")

    fun parse(body: String): CoreRuntimeImportResult {
        require(okPattern.containsMatchIn(body)) { "Core runtime returned an invalid success response" }
        val nodeCount = nodeCountPattern.find(body)?.groupValues?.get(1)?.toIntOrNull()
            ?: throw IllegalArgumentException("Core runtime response is missing nodeCount")
        require(nodeCount >= 0) { "Core runtime returned a negative nodeCount" }

        return CoreRuntimeImportResult(
            source = sourcePattern.find(body)?.groupValues?.get(1)?.unescapeJsonString(),
            nodeCount = nodeCount,
            kernel = kernelPattern.find(body)?.groupValues?.get(1)?.unescapeJsonString(),
            detectionConfidence = confidencePattern.find(body)?.groupValues?.get(1)?.unescapeJsonString(),
        )
    }

    private fun String.unescapeJsonString(): String =
        replace("\\", "\").replace("\"", """)
}
