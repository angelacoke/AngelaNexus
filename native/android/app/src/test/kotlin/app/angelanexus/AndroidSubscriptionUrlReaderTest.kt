package app.angelanexus

import java.io.ByteArrayInputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.nio.charset.StandardCharsets
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class AndroidSubscriptionUrlReaderTest {
    @Test
    fun readsStrictUtf8WithinConfiguredByteLimit() {
        val reader = AndroidSubscriptionUrlReader(
            maxBytes = 32,
            connectionFactory = { FakeConnection(it.toURL(), 200, "vless://节点".toByteArray(StandardCharsets.UTF_8)) },
        )

        assertEquals("vless://节点", reader.read("https://example.test/sub"))
    }

    @Test
    fun rejectsResponseLargerThanConfiguredLimit() {
        val reader = AndroidSubscriptionUrlReader(
            maxBytes = 4,
            connectionFactory = { FakeConnection(it.toURL(), 200, "12345".toByteArray()) },
        )

        assertFailsWith<IllegalArgumentException> { reader.read("https://example.test/sub") }
    }

    @Test
    fun rejectsDeclaredOversizedResponseBeforeReadingBody() {
        val reader = AndroidSubscriptionUrlReader(
            maxBytes = 4,
            connectionFactory = { FakeConnection(it.toURL(), 200, byteArrayOf(), mapOf("Content-Length" to "5")) },
        )

        assertFailsWith<IOException> { reader.read("https://example.test/sub") }
    }

    @Test
    fun followsBoundedRelativeRedirects() {
        val requests = mutableListOf<URI>()
        val responses = ArrayDeque(
            listOf(
                FakeConnection(URL("https://example.test/start"), 302, byteArrayOf(), mapOf("Location" to "/next")),
                FakeConnection(URL("https://example.test/next"), 200, "proxies: []".toByteArray()),
            ),
        )
        val reader = AndroidSubscriptionUrlReader(connectionFactory = { uri ->
            requests += uri
            responses.removeFirst()
        })

        assertEquals("proxies: []", reader.read("https://example.test/start"))
        assertEquals(listOf(URI("https://example.test/start"), URI("https://example.test/next")), requests)
    }

    @Test
    fun rejectsHttpsRedirectDowngrade() {
        val reader = AndroidSubscriptionUrlReader(connectionFactory = {
            FakeConnection(it.toURL(), 302, byteArrayOf(), mapOf("Location" to "http://example.test/sub"))
        })

        assertFailsWith<IOException> { reader.read("https://example.test/start") }
    }

    @Test
    fun rejectsCredentialsAndUnsupportedSchemes() {
        val reader = AndroidSubscriptionUrlReader()

        assertFailsWith<IllegalArgumentException> { reader.read("https://user:pass@example.test/sub") }
        assertFailsWith<IllegalArgumentException> { reader.read("http://example.test/sub") }
        assertFailsWith<IllegalArgumentException> { reader.read("file:///tmp/sub") }
    }

    private class FakeConnection(
        url: URL,
        private val status: Int,
        private val bytes: ByteArray,
        private val headers: Map<String, String> = emptyMap(),
    ) : HttpURLConnection(url) {
        override fun disconnect() = Unit
        override fun usingProxy(): Boolean = false
        override fun connect() = Unit
        override fun getResponseCode(): Int = status
        override fun getInputStream() = ByteArrayInputStream(bytes)
        override fun getHeaderField(name: String): String? = headers.entries
            .firstOrNull { it.key.equals(name, ignoreCase = true) }
            ?.value
    }
}
