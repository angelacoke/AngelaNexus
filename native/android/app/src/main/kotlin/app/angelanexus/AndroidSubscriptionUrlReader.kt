package app.angelanexus

import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URI

/** Downloads subscription text with the same bounded-input guarantees as local imports. */
class AndroidSubscriptionUrlReader(
    private val maxBytes: Int = ConfigImportReader.DEFAULT_MAX_BYTES,
    private val timeoutMs: Int = DEFAULT_TIMEOUT_MS,
    private val connectionFactory: (URI) -> HttpURLConnection = { uri ->
        uri.toURL().openConnection() as HttpURLConnection
    },
) : SubscriptionContentReader {
    init {
        require(maxBytes > 0) { "subscription maxBytes must be positive" }
        require(timeoutMs in 1..MAX_TIMEOUT_MS) {
            "subscription timeoutMs must be between 1 and $MAX_TIMEOUT_MS"
        }
    }

    override fun read(url: String): String {
        var target = validatedUri(url)
        val deadlineNanos = System.nanoTime() + timeoutMs * NANOS_PER_MILLISECOND

        for (redirectCount in 0..MAX_REDIRECTS) {
            val remainingTimeout = remainingTimeoutMillis(deadlineNanos)
            val connection = connectionFactory(target)
            try {
                connection.instanceFollowRedirects = false
                connection.requestMethod = "GET"
                connection.connectTimeout = remainingTimeout
                connection.readTimeout = remainingTimeout
                connection.setRequestProperty("Accept", "text/plain, application/yaml, application/json, */*")
                connection.setRequestProperty("Cache-Control", "no-cache")

                val status = connection.responseCode
                if (status in REDIRECT_STATUSES) {
                    if (redirectCount == MAX_REDIRECTS) {
                        throw IOException("subscription exceeded the redirect limit")
                    }
                    val location = connection.getHeaderField("Location")
                        ?.takeIf { it.isNotBlank() }
                        ?: throw IOException("subscription redirect is missing a Location header")
                    val resolved = target.resolve(location.trim())
                    if (!resolved.scheme.equals("https", ignoreCase = true)) {
                        throw IOException("subscription redirects must use HTTPS")
                    }
                    val next = validatedUri(resolved)
                    target = next
                    continue
                }
                if (status !in 200..299) {
                    throw IOException("subscription request failed: HTTP $status")
                }
                val declaredLength = connection.getHeaderField("Content-Length")?.toLongOrNull()
                if (declaredLength != null && declaredLength > maxBytes) {
                    throw IOException("subscription exceeds the $maxBytes byte limit")
                }
                return connection.inputStream.use { input ->
                    readBoundedUtf8(connection, input, deadlineNanos)
                }
            } finally {
                connection.disconnect()
            }
        }
        throw IOException("subscription exceeded the redirect limit")
    }

    private fun readBoundedUtf8(
        connection: HttpURLConnection,
        input: java.io.InputStream,
        deadlineNanos: Long,
    ): String {
        val buffer = ByteArray(8192)
        val output = java.io.ByteArrayOutputStream()
        var total = 0
        while (true) {
            connection.readTimeout = remainingTimeoutMillis(deadlineNanos)
            val count = input.read(buffer)
            if (count < 0) break
            if (total > maxBytes - count) {
                throw IllegalArgumentException("configuration exceeds $maxBytes bytes")
            }
            output.write(buffer, 0, count)
            total += count
        }
        return ConfigImportReader.readUtf8(
            java.io.ByteArrayInputStream(output.toByteArray()),
            maxBytes,
        )
    }

    private fun validatedUri(value: String): URI {
        val uri = try {
            URI(value.trim())
        } catch (error: Exception) {
            throw IllegalArgumentException("subscription URL is invalid", error)
        }
        return validatedUri(uri)
    }

    private fun validatedUri(uri: URI): URI {
        val normalized = uri.normalize()
        val scheme = normalized.scheme
        require(normalized.isAbsolute &&
            scheme.equals("https", ignoreCase = true) &&
            !normalized.host.isNullOrBlank() &&
            normalized.rawUserInfo == null
        ) {
            "subscription URL must use HTTPS, include a host, and contain no embedded credentials"
        }
        return normalized
    }

    private fun remainingTimeoutMillis(deadlineNanos: Long): Int {
        val remainingNanos = deadlineNanos - System.nanoTime()
        if (remainingNanos <= 0) throw SocketTimeoutException("subscription request timed out")
        val roundedMillis = (remainingNanos + NANOS_PER_MILLISECOND - 1) / NANOS_PER_MILLISECOND
        return roundedMillis.coerceIn(1L, timeoutMs.toLong()).toInt()
    }

    companion object {
        const val DEFAULT_TIMEOUT_MS = 30_000
        const val MAX_TIMEOUT_MS = 30_000
        const val MAX_REDIRECTS = 5
        private const val NANOS_PER_MILLISECOND = 1_000_000L
        private val REDIRECT_STATUSES = setOf(301, 302, 303, 307, 308)
    }
}
