package app.angelanexus

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidTrafficAcceptanceProbeTest {
    @Test
    fun successfulHttpResponseIsAcceptedAsRealTrafficEvidence() {
        var connected = false
        val probe = AndroidTrafficAcceptanceProbe {
            FakeHttpConnection(URL("https://acceptance.test/"), 204, mapOf("X-Proxy-Egress" to "verified-egress"))
                .also { it.onConnect = { connected = true } }
        }

        val result = probe.probe(
            "https://acceptance.test/",
            expectedResponseHeader = "X-Proxy-Egress",
            expectedResponseValue = "verified-egress",
        )

        assertTrue(connected)
        assertEquals(AndroidTrafficAcceptanceProbe.RESULT_SUCCESS, result.result)
        assertEquals(204, result.statusCode)
        assertEquals("https://acceptance.test/", result.targetUrl)
    }

    @Test
    fun successfulHttpResponseWithoutExpectedProxyMarkerIsRejected() {
        val probe = AndroidTrafficAcceptanceProbe {
            FakeHttpConnection(URL("https://acceptance.test/"), 204)
        }

        val result = probe.probe(
            "https://acceptance.test/",
            expectedResponseHeader = "X-Proxy-Egress",
            expectedResponseValue = "verified-egress",
        )

        assertEquals(AndroidTrafficAcceptanceProbe.RESULT_FAILURE, result.result)
        assertEquals("proxy-evidence-header-missing", result.reason)
    }

    @Test
    fun mismatchedProxyMarkerIsRejected() {
        val probe = AndroidTrafficAcceptanceProbe {
            FakeHttpConnection(URL("https://acceptance.test/"), 204, mapOf("X-Proxy-Egress" to "direct-egress"))
        }

        val result = probe.probe(
            "https://acceptance.test/",
            expectedResponseHeader = "X-Proxy-Egress",
            expectedResponseValue = "verified-egress",
        )

        assertEquals(AndroidTrafficAcceptanceProbe.RESULT_FAILURE, result.result)
        assertEquals("proxy-evidence-header-mismatch", result.reason)
    }

    @Test
    fun nonSuccessfulHttpResponseIsRejected() {
        val probe = AndroidTrafficAcceptanceProbe {
            FakeHttpConnection(URL("https://acceptance.test/"), 503)
        }

        val result = probe.probe("https://acceptance.test/")

        assertEquals(AndroidTrafficAcceptanceProbe.RESULT_FAILURE, result.result)
        assertEquals(503, result.statusCode)
        assertEquals("unexpected-http-status", result.reason)
    }

    @Test
    fun plaintextTargetIsRejectedBeforeOpeningConnection() {
        var opened = false
        val probe = AndroidTrafficAcceptanceProbe {
            opened = true
            FakeHttpConnection(URL("https://unused.test/"), 204)
        }

        try {
            probe.probe("http://acceptance.test/")
            throw AssertionError("HTTP target must be rejected")
        } catch (error: IllegalArgumentException) {
            assertEquals("traffic acceptance target must use HTTPS", error.message)
        }

        assertFalse(opened)
    }

    @Test
    fun cancellationBeforeProbeDoesNotOpenAConnection() {
        var opened = false
        val probe = AndroidTrafficAcceptanceProbe {
            opened = true
            FakeHttpConnection(URL("https://unused.test/"), 204)
        }
        probe.cancel()

        val result = probe.probe("https://acceptance.test/")

        assertFalse(opened)
        assertEquals(AndroidTrafficAcceptanceProbe.RESULT_CANCELLED, result.result)
        assertEquals("cancelled", result.reason)
    }

    @Test
    fun cancellationDisconnectsAnInFlightConnection() {
        val connecting = CountDownLatch(1)
        val disconnected = CountDownLatch(1)
        val connection = BlockingHttpConnection(
            URL("https://acceptance.test/"),
            connecting,
            disconnected,
        )
        val probe = AndroidTrafficAcceptanceProbe { connection }
        val executor = Executors.newSingleThreadExecutor()

        try {
            val result = executor.submit<AndroidTrafficAcceptanceResult> {
                probe.probe("https://acceptance.test/")
            }
            assertTrue("probe should reach connect", connecting.await(5, TimeUnit.SECONDS))
            probe.cancel()

            val completed = result.get(5, TimeUnit.SECONDS)
            assertEquals(AndroidTrafficAcceptanceProbe.RESULT_CANCELLED, completed.result)
            assertEquals("cancelled", completed.reason)
            assertTrue("cancel should disconnect the active connection", connection.disconnectObserved)
        } finally {
            executor.shutdownNow()
        }
    }

    private class FakeHttpConnection(
        url: URL,
        private val response: Int,
        private val responseHeaders: Map<String, String> = emptyMap(),
    ) : HttpURLConnection(url) {
        var onConnect: (() -> Unit)? = null

        override fun connect() {
            onConnect?.invoke()
            connected = true
        }

        override fun disconnect() {
            connected = false
        }

        override fun usingProxy(): Boolean = false

        override fun getResponseCode(): Int = response

        override fun getHeaderField(name: String?): String? =
            responseHeaders.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value
    }

    private class BlockingHttpConnection(
        url: URL,
        private val connecting: CountDownLatch,
        private val disconnected: CountDownLatch,
    ) : HttpURLConnection(url) {
        @Volatile
        var disconnectObserved = false
            private set

        override fun connect() {
            connecting.countDown()
            if (!disconnected.await(5, TimeUnit.SECONDS)) throw IOException("connect timed out")
            connected = true
        }

        override fun disconnect() {
            disconnectObserved = true
            connected = false
            disconnected.countDown()
        }

        override fun usingProxy(): Boolean = false

        override fun getResponseCode(): Int = 204
    }
}
