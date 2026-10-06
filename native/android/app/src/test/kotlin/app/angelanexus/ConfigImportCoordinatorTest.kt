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
                "config.yaml"
            )
            assertEquals(expected, result)
        }

        val request = assertNotNull(received)
        assertEquals(ConfigImportRequest.VERSION, request.version)
        assertEquals(ConfigImportRequest.Source.LOCAL_FILE, request.source)
        assertEquals("config.yaml", request.name)
        assertEquals(content, request.content)
    }

    @Test
    fun sendsTextToCoreWithoutAndroidClassification() {
        var received: ConfigImportRequest? = null
        val port = object : ConfigImportPort {
            override suspend fun importConfiguration(request: ConfigImportRequest): CoreRuntimeImportResult {
                received = request
                return CoreRuntimeImportResult("text", 1, "xray", "high")
            }
        }

        kotlinx.coroutines.runBlocking {
            ConfigImportCoordinator(port).importText("  vless://example  ", "single-node")
        }

        val request = assertNotNull(received)
        assertEquals(ConfigImportRequest.Source.TEXT, request.source)
        assertEquals("single-node", request.name)
        assertEquals("vless://example", request.content)
    }

    @Test
    fun sendsSubscriptionUrlToCoreAndRejectsEmbeddedCredentials() {
        var received: ConfigImportRequest? = null
        val port = object : ConfigImportPort {
            override suspend fun importConfiguration(request: ConfigImportRequest): CoreRuntimeImportResult {
                received = request
                return CoreRuntimeImportResult("subscription", 10, "sing-box", "high")
            }
        }
        val coordinator = ConfigImportCoordinator(port)

        kotlinx.coroutines.runBlocking {
            coordinator.importSubscriptionUrl("https://example.com/sub", "remote")
        }

        val request = assertNotNull(received)
        assertEquals(ConfigImportRequest.Source.SUBSCRIPTION_URL, request.source)
        assertEquals("https://example.com/sub", request.content)

        assertFailsWith<IllegalArgumentException> {
            kotlinx.coroutines.runBlocking {
                coordinator.importSubscriptionUrl("https://user:pass@example.com/sub")
            }
        }
    }

    @Test
    fun rejectsUnsupportedSubscriptionScheme() {
        assertFailsWith<IllegalArgumentException> {
            kotlinx.coroutines.runBlocking {
                ConfigImportCoordinator(object : ConfigImportPort {
                    override suspend fun importConfiguration(
                        request: ConfigImportRequest,
                    ): CoreRuntimeImportResult = error("must not reach Core")
                }).importSubscriptionUrl("file:///tmp/config")
            }
        }
    }
}
