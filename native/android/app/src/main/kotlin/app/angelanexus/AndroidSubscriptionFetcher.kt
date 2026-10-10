package app.angelanexus

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

/**
 * One-shot Android subscription download. The URL is used only for this request;
 * neither the URL nor response bytes are persisted or logged by this class.
 */
class AndroidSubscriptionFetcher(
    private val connectionFactory: (URL) -> HttpURLConnection = {
        it.openConnection() as HttpURLConnection
    },
    private val connectTimeoutMs: Int = DEFAULT_CONNECT_TIMEOUT_MS,
    private val readTimeoutMs: Int = DEFAULT_READ_TIMEOUT_MS,
    private val maxResponseBytes: Int = DEFAULT_MAX_RESPONSE_BYTES,
    private val maxRedirects: Int = DEFAULT_MAX_REDIRECTS,
) {
    init {
        require(connectTimeoutMs > 0) { "connect timeout must be positive" }
        require(readTimeoutMs > 0) { "read timeout must be positive" }
        require(maxResponseBytes > 0) { "subscription response limit must be positive" }
        require(maxRedirects >= 0) { "subscription redirect limit must not be negative" }
    }

    fun fetch(subscriptionUrl: String): ByteArray {
        var target = validateHttpsUrl(subscriptionUrl)
        var redirects = 0

        while (true) {
            val connection = connectionFactory(target)
            try {
                connection.instanceFollowRedirects = false
                connection.requestMethod = "GET"
                connection.connectTimeout = connectTimeoutMs
                connection.readTimeout = readTimeoutMs
                connection.useCaches = false
                connection.setRequestProperty("Accept", "application/json, application/yaml, text/plain, */*")
                connection.setRequestProperty("Accept-Encoding", "identity")

                val status = connection.responseCode
                if (status in 300..399) {
                    if (redirects >= maxRedirects) {
                        throw IOException("subscription redirect limit exceeded")
                    }
                    val location = connection.getHeaderField("Location")
                        ?.takeIf { it.isNotBlank() }
                        ?: throw IOException("subscription redirect is missing its destination")
                    target = validateHttpsUrl(location, target)
                    redirects += 1
                    continue
                }

                if (status !in 200..299) throw IOException("subscription download failed")
                val contentLength = connection.getHeaderFieldLong("Content-Length", -1L)
                if (contentLength > maxResponseBytes) {
                    throw IOException("subscription exceeds the 5 MiB download limit")
                }
                val contentEncoding = connection.getHeaderField("Content-Encoding")
                if (!contentEncoding.isNullOrBlank() && !contentEncoding.equals("identity", ignoreCase = true)) {
                    throw IOException("compressed subscription responses are not supported")
                }
                return connection.inputStream.use { readBounded(it) }
            } finally {
                connection.disconnect()
            }
        }
    }

    private fun readBounded(input: java.io.InputStream): ByteArray {
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        val output = WipingByteArrayOutputStream()
        var total = 0
        try {
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                if (total > maxResponseBytes - count) {
                    throw IOException("subscription exceeds the 5 MiB download limit")
                }
                output.write(buffer, 0, count)
                total += count
            }
            return output.toByteArray()
        } finally {
            buffer.fill(0)
            output.clear()
        }
    }

    private fun validateHttpsUrl(value: String, base: URL? = null): URL {
        if (value.isBlank()) throw IllegalArgumentException("subscription URL is required")
        return try {
            val input = URI(value.trim())
            val resolved = base?.toURI()?.resolve(input) ?: input
            require(resolved.scheme.equals("https", ignoreCase = true)) {
                "subscription URLs must use HTTPS"
            }
            require(resolved.rawUserInfo == null) {
                "subscription URL must not contain embedded credentials"
            }
            require(!resolved.host.isNullOrBlank()) { "subscription URL must include a host" }
            require(resolved.port == -1 || resolved.port in 1..65535) {
                "subscription URL has an invalid port"
            }
            resolved.normalize().toURL()
        } catch (error: IllegalArgumentException) {
            throw error
        } catch (_: Exception) {
            // Do not include the supplied URL in the error; subscription URLs can contain tokens.
            throw IllegalArgumentException("subscription URL is invalid")
        }
    }

    companion object {
        const val DEFAULT_CONNECT_TIMEOUT_MS = 10_000
        const val DEFAULT_READ_TIMEOUT_MS = 20_000
        const val DEFAULT_MAX_RESPONSE_BYTES = ConfigImportReader.DEFAULT_MAX_BYTES
        const val DEFAULT_MAX_REDIRECTS = 5
    }

    private class WipingByteArrayOutputStream : ByteArrayOutputStream() {
        fun clear() {
            buf.fill(0)
            reset()
        }
    }
}

internal fun isValidAndroidSubscriptionUrl(value: String): Boolean {
    if (value.isBlank()) return false
    return runCatching {
        val uri = URI(value.trim())
        uri.scheme.equals("https", ignoreCase = true) &&
            uri.rawUserInfo == null &&
            !uri.host.isNullOrBlank() &&
            (uri.port == -1 || uri.port in 1..65535)
    }.getOrDefault(false)
}
