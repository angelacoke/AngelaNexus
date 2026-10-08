package app.angelanexus

import java.net.HttpURLConnection
import java.net.URL

/**
 * Performs a real HTTPS request for Android data-plane acceptance.
 *
 * This is deliberately an explicit probe target. The probe never invents a
 * destination and never treats native lifecycle state as traffic evidence.
 */
class AndroidTrafficAcceptanceProbe(
    private val openConnection: (URL) -> HttpURLConnection = {
        it.openConnection() as HttpURLConnection
    },
) {
    fun probe(
        targetUrl: String,
        timeoutMs: Int = DEFAULT_TIMEOUT_MS,
    ): AndroidTrafficAcceptanceResult {
        val url = validateTarget(targetUrl)
        require(timeoutMs > 0) { "traffic acceptance timeout must be positive" }

        val startedAt = System.nanoTime()
        var connection: HttpURLConnection? = null
        return try {
            connection = openConnection(url).apply {
                requestMethod = "GET"
                connectTimeout = timeoutMs
                readTimeout = timeoutMs
                useCaches = false
                instanceFollowRedirects = false
                setRequestProperty("Accept-Encoding", "identity")
                setRequestProperty("Cache-Control", "no-cache")
            }

            connection.connect()
            val statusCode = connection.responseCode
            val durationMs = elapsedMs(startedAt)

            if (statusCode in 200..299) {
                AndroidTrafficAcceptanceResult(
                    result = RESULT_SUCCESS,
                    targetUrl = url.toExternalForm(),
                    statusCode = statusCode,
                    durationMs = durationMs,
                    reason = null,
                )
            } else {
                AndroidTrafficAcceptanceResult(
                    result = RESULT_FAILURE,
                    targetUrl = url.toExternalForm(),
                    statusCode = statusCode,
                    durationMs = durationMs,
                    reason = "unexpected-http-status",
                )
            }
        } catch (error: Exception) {
            AndroidTrafficAcceptanceResult(
                result = RESULT_FAILURE,
                targetUrl = url.toExternalForm(),
                statusCode = null,
                durationMs = elapsedMs(startedAt),
                reason = error.message ?: error::class.java.simpleName,
            )
        } finally {
            connection?.disconnect()
        }
    }

    private fun validateTarget(targetUrl: String): URL {
        val value = targetUrl.trim()
        require(value.isNotEmpty()) { "traffic acceptance target is required" }
        val url = URL(value)
        require(url.protocol.equals("https", ignoreCase = true)) {
            "traffic acceptance target must use HTTPS"
        }
        require(!url.host.isNullOrBlank()) {
            "traffic acceptance target must include a host"
        }
        require(url.userInfo == null) {
            "traffic acceptance target must not contain user credentials"
        }
        return url
    }

    private fun elapsedMs(startedAt: Long): Long =
        ((System.nanoTime() - startedAt) / 1_000_000L).coerceAtLeast(0L)

    companion object {
        const val RESULT_SUCCESS = "success"
        const val RESULT_FAILURE = "failure"
        const val DEFAULT_TIMEOUT_MS = 5000
    }
}

data class AndroidTrafficAcceptanceResult(
    val result: String,
    val targetUrl: String,
    val statusCode: Int?,
    val durationMs: Long,
    val reason: String?,
)
