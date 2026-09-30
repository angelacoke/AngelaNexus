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
        val port = object : ConfigImportPort {
            override suspend fun importConfiguration(request: ConfigImportRequest) {
                received = request
            }
        }

        val coordinator = ConfigImportCoordinator(port)
        val content = "proxies:\n  - name: example"

        kotlinx.coroutines.runBlocking {
            coordinator.importLocalFile(
                ByteArrayInputStream(content.toByteArray(StandardCharsets.UTF_8)),
                "config.yaml"
            )
        }

        val request = assertNotNull(received)
        assertEquals(ConfigImportRequest.VERSION, request.version)
        assertEquals(ConfigImportRequest.Source.LOCAL_FILE, request.source)
        assertEquals("config.yaml", request.name)
        assertEquals(content, request.content)
    }
}
