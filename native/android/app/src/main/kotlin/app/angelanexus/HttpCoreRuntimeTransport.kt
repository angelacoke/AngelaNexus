package app.angelanexus

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI

/**
 * Concrete transport from the Android shell to a locally hosted Core runtime.
 *
 * The Android layer sends the already-serialized import envelope only. Core remains
 * responsible for parsing, detection, normalization, and kernel binding.
 */
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

    override suspend fun sendConfigurationImport(payload: String) {
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
            if (status !in 200..299) {
                throw IOException("Core runtime rejected configuration import: HTTP $status")
            }
        } finally {
            connection.disconnect()
        }
    }
}
