package app.angelanexus

import java.io.ByteArrayInputStream
import java.nio.charset.StandardCharsets
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull

class ConfigImportCoordinatorTest {
    @Test
    fun convertsLocalFileIntoVersionedPortRequest() {
        var received: ConfigImportRequest? = null
        val expected = CoreRuntimeImportResult("local-file", 3, "mihomo", "detected")
        val port = object : ConfigImportPort {
            override suspend fun importConfiguration(request: ConfigImportRequest): CoreRuntimeImportResult {
                received = request
                return expected
            }
        }

        val coordinator = ConfigImportCoordinator(port)
        val content = "proxies:\n  - name: example"

        kotlinx.coroutines.runBlocking {
            val result = coordinator.importLocalFile(
                ByteArrayInputStream(content.toByteArray(StandardCharsets.UTF_8)),
                "config.yaml",
                ConfigImportRequest.TrafficAcceptancePolicy(
                    targetUrl = "https://example.test/health",
                    timeoutMs = 7000,
                ),
            )
            assertEquals(expected, result)
        }

        val request = assertNotNull(received)
        assertEquals(ConfigImportRequest.VERSION, request.version)
        assertEquals(ConfigImportRequest.Source.LOCAL_FILE, request.source)
        assertEquals("config.yaml", request.name)
        assertEquals(content, request.content)
        assertEquals(
            ConfigImportRequest.TrafficAcceptancePolicy(
                targetUrl = "https://example.test/health",
                timeoutMs = 7000,
            ),
            request.trafficAcceptance,
        )
    }

    @Test
    fun sendsPastedNodeTextToCoreWithTextSource() {
        var received: ConfigImportRequest? = null
        val expected = CoreRuntimeImportResult("text", 1, "xray", "detected")
        val port = object : ConfigImportPort {
            override suspend fun importConfiguration(request: ConfigImportRequest): CoreRuntimeImportResult {
                received = request
                return expected
            }
        }
        val content = "vless://node.example:443#Example"

        val result = kotlinx.coroutines.runBlocking {
            ConfigImportCoordinator(port).importText(content, "Pasted configuration")
        }

        assertEquals(expected, result)
        val request = assertNotNull(received)
        assertEquals(ConfigImportRequest.Source.TEXT, request.source)
        assertEquals("Pasted configuration", request.name)
        assertEquals(content, request.content)
    }

    @Test
    fun rejectsBlankOrOversizedPastedTextBeforeCallingCore() {
        var called = false
        val port = object : ConfigImportPort {
            override suspend fun importConfiguration(request: ConfigImportRequest): CoreRuntimeImportResult {
                called = true
                return CoreRuntimeImportResult("text", 0, null, "detected")
            }
        }
        val coordinator = ConfigImportCoordinator(port)

        assertFailsWith<IllegalArgumentException> {
            kotlinx.coroutines.runBlocking { coordinator.importText(" \n\t ", "Pasted configuration") }
        }
        assertFailsWith<IllegalArgumentException> {
            kotlinx.coroutines.runBlocking {
                coordinator.importText("x".repeat(ConfigImportReader.DEFAULT_MAX_BYTES + 1), "Pasted configuration")
            }
        }
        assertEquals(false, called)
    }

    @Test
    fun sendsDownloadedSubscriptionBodyToCoreWithoutRetainingItsUrl() {
        var received: ConfigImportRequest? = null
        val expected = CoreRuntimeImportResult("subscription-url", 2, "sing-box", "detected")
        val port = object : ConfigImportPort {
            override suspend fun importConfiguration(request: ConfigImportRequest): CoreRuntimeImportResult {
                received = request
                return expected
            }
        }
        val content = "vless://node.example:443#Example"
        val result = kotlinx.coroutines.runBlocking {
            ConfigImportCoordinator(port).importSubscriptionContent(
                ByteArrayInputStream(content.toByteArray(StandardCharsets.UTF_8)),
                "Imported subscription",
            )
        }

        assertEquals(expected, result)
        val request = assertNotNull(received)
        assertEquals(ConfigImportRequest.Source.SUBSCRIPTION_URL, request.source)
        assertEquals("Imported subscription", request.name)
        assertEquals(content, request.content)
    }
}
