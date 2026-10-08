package app.angelanexus

import java.net.HttpURLConnection
import java.net.URL
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidTrafficAcceptanceProbeTest {
    @Test
    fun successfulHttpResponseIsAcceptedAsRealTrafficEvidence() {
        var connected = false
        val probe = AndroidTrafficAcceptanceProbe { FakeHttpConnection(URL("https://acceptance.test/"), 204).also { it.onConnect = { connected = true } } }

        val result = probe.probe("https://acceptance.test/")

        assertTrue(connected)
        assertEquals(AndroidTrafficAcceptanceProbe.RESULT_SUCCESS, result.result)
        assertEquals(204, result.statusCode)
        assertEquals("https://acceptance.test/", result.targetUrl)
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

    private class FakeHttpConnection(
        url: URL,
        private val response: Int,
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

        override val responseCode: Int
            get() = response
    }
}
