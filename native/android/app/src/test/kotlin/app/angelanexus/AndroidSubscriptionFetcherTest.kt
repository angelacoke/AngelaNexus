package app.angelanexus

import java.io.ByteArrayInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AndroidSubscriptionFetcherTest {
    @Test
    fun downloadsHttpsContentWithBoundedRequestSettings() {
        val connection = StubConnection(
            URL("https://example.test/subscription"),
            status = 200,
            body = "proxies: []".toByteArray(),
        )
        val fetcher = AndroidSubscriptionFetcher(connectionFactory = { connection })

        assertContentEquals("proxies: []".toByteArray(), fetcher.fetch("https://example.test/subscription"))
        assertEquals("GET", connection.requestMethod)
        assertEquals(AndroidSubscriptionFetcher.DEFAULT_CONNECT_TIMEOUT_MS, connection.connectTimeout)
        assertEquals(AndroidSubscriptionFetcher.DEFAULT_READ_TIMEOUT_MS, connection.readTimeout)
        assertFalse(connection.instanceFollowRedirects)
        assertEquals("identity", connection.requestProperties["Accept-Encoding"])
        assertTrue(connection.disconnected)
    }

    @Test
    fun rejectsHttpAndEmbeddedCredentialsBeforeOpeningAConnection() {
        assertTrue(isValidAndroidSubscriptionUrl("https://example.test/subscription?token=secret"))
        assertFalse(isValidAndroidSubscriptionUrl("http://example.test/subscription"))
        assertFalse(isValidAndroidSubscriptionUrl("https://user:secret@example.test/subscription"))
        var opened = 0
        val fetcher = AndroidSubscriptionFetcher(connectionFactory = {
            opened += 1
            StubConnection(it, status = 200)
        })

        assertFailsWith<IllegalArgumentException> { fetcher.fetch("http://example.test/subscription") }
        val credentialFailure = assertFailsWith<IllegalArgumentException> {
            fetcher.fetch("https://user:secret@example.test/subscription")
        }
        assertFalse(credentialFailure.message.orEmpty().contains("secret"))
        assertEquals(0, opened)
    }

    @Test
    fun followsRelativeHttpsRedirectAndDisconnectsEachConnection() {
        val opened = mutableListOf<StubConnection>()
        val fetcher = AndroidSubscriptionFetcher(connectionFactory = { url ->
            val connection = if (opened.isEmpty()) {
                StubConnection(url, status = 302, headers = mapOf("Location" to "/next"))
            } else {
                StubConnection(url, status = 200, body = byteArrayOf(7, 8, 9))
            }
            opened += connection
            connection
        })

        assertContentEquals(byteArrayOf(7, 8, 9), fetcher.fetch("https://example.test/start"))
        assertEquals("/next", opened.last().url.path)
        assertTrue(opened.all { it.disconnected })
    }

    @Test
    fun rejectsHttpsToHttpRedirectDowngrade() {
        val connection = StubConnection(
            URL("https://example.test/start"),
            status = 302,
            headers = mapOf("Location" to "http://example.test/plain"),
        )
        val fetcher = AndroidSubscriptionFetcher(connectionFactory = { connection })

        assertFailsWith<IllegalArgumentException> {
            fetcher.fetch("https://example.test/start?token=secret")
        }
        assertTrue(connection.disconnected)
    }

    @Test
    fun enforcesResponseSizeWhenLengthIsMissingOrIncorrect() {
        val bodyTooLarge = StubConnection(
            URL("https://example.test/subscription"),
            status = 200,
            body = byteArrayOf(1, 2, 3, 4),
        )
        val streamingFetcher = AndroidSubscriptionFetcher(
            connectionFactory = { bodyTooLarge },
            maxResponseBytes = 3,
        )
        assertFailsWith<java.io.IOException> {
            streamingFetcher.fetch("https://example.test/subscription")
        }
        assertTrue(bodyTooLarge.disconnected)

        val declaredTooLarge = StubConnection(
            URL("https://example.test/subscription"),
            status = 200,
            headers = mapOf("Content-Length" to "4"),
            body = byteArrayOf(1, 2, 3),
        )
        val lengthFetcher = AndroidSubscriptionFetcher(
            connectionFactory = { declaredTooLarge },
            maxResponseBytes = 3,
        )
        assertFailsWith<java.io.IOException> {
            lengthFetcher.fetch("https://example.test/subscription")
        }
        assertTrue(declaredTooLarge.disconnected)
    }

    @Test
    fun rejectsUnexpectedStatusAndCompressedResponses() {
        val failed = StubConnection(URL("https://example.test/subscription"), status = 503)
        assertFailsWith<java.io.IOException> {
            AndroidSubscriptionFetcher(connectionFactory = { failed })
                .fetch("https://example.test/subscription")
        }
        assertTrue(failed.disconnected)

        val compressed = StubConnection(
            URL("https://example.test/subscription"),
            status = 200,
            headers = mapOf("Content-Encoding" to "gzip"),
            body = byteArrayOf(1),
        )
        assertFailsWith<java.io.IOException> {
            AndroidSubscriptionFetcher(connectionFactory = { compressed })
                .fetch("https://example.test/subscription")
        }
        assertTrue(compressed.disconnected)
    }

    private class StubConnection(
        url: URL,
        private val status: Int,
        private val headers: Map<String, String> = emptyMap(),
        private val body: ByteArray = byteArrayOf(),
    ) : HttpURLConnection(url) {
        var disconnected = false
            private set
        val requestProperties = mutableMapOf<String, String>()

        override fun connect() = Unit
        override fun disconnect() { disconnected = true }
        override fun usingProxy(): Boolean = false
        override fun getResponseCode(): Int = status
        override fun getHeaderField(name: String?): String? =
            headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value
        override fun getInputStream(): InputStream = ByteArrayInputStream(body)
        override fun setRequestProperty(key: String, value: String) {
            requestProperties[key] = value
        }
    }
}
