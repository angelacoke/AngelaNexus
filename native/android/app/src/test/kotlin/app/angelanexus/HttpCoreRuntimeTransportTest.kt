package app.angelanexus

import java.net.HttpURLConnection
import java.net.URI
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class HttpCoreRuntimeTransportTest {
    @Test
    fun sendsSerializedEnvelopeToCoreEndpoint() = kotlinx.coroutines.test.runTest {
        var method: String? = null
        var contentType: String? = null
        var accept: String? = null
        var body = ""

        val connection = RecordingConnection(URI("http://127.0.0.1:18181/v1/runtime/import"))
        val transport = HttpCoreRuntimeTransport(
            URI("http://127.0.0.1:18181/"),
            connectionFactory = { connection }
        )

        transport.sendConfigurationImport("""{"type":"angelanexus.config-import"}""")

        method = connection.requestMethod
        contentType = connection.requestProperty("Content-Type")
        accept = connection.requestProperty("Accept")
        body = connection.body

        assertEquals("POST", method)
        assertEquals("application/json; charset=utf-8", contentType)
        assertEquals("application/json", accept)
        assertEquals("""{"type":"angelanexus.config-import"}""", body)
        assertTrue(connection.disconnected)
    }

    @Test
    fun failsClosedWhenCoreRejectsImport() = kotlinx.coroutines.test.runTest {
        val connection = RecordingConnection(
            URI("http://127.0.0.1:18181/v1/runtime/import"),
            responseCode = 503
        )
        val transport = HttpCoreRuntimeTransport(
            URI("http://127.0.0.1:18181/"),
            connectionFactory = { connection }
        )

        assertFailsWith<java.io.IOException> {
            transport.sendConfigurationImport("{}")
        }
        assertTrue(connection.disconnected)
    }

    private class RecordingConnection(url: URI, private val responseCode: Int = 204) :
        HttpURLConnection(url.toURL()) {
        private val properties = mutableMapOf<String, String>()
        private val output = java.io.ByteArrayOutputStream()
        var disconnected = false
            private set
        var body: String = ""
            private set

        override fun disconnect() {
            body = output.toString(Charsets.UTF_8.name())
            disconnected = true
        }

        override fun usingProxy(): Boolean = false
        override fun connect() {}
        override fun getResponseCode(): Int = responseCode
        override fun setRequestProperty(key: String, value: String) {
            properties[key] = value
        }
        override fun getRequestProperty(key: String): String? = properties[key]
        override fun getOutputStream(): java.io.OutputStream = output
    }
}
