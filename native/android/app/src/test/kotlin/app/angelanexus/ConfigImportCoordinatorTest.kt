package app.angelanexus

import java.io.ByteArrayInputStream
import java.nio.charset.StandardCharsets
import kotlin.test.Test
import kotlin.test.assertEquals
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
}
