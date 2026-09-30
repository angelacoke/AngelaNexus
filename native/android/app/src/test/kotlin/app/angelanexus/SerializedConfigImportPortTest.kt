package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertEquals

class SerializedConfigImportPortTest {
    @Test
    fun forwardsOnlySerializedEnvelopeToCoreTransport() {
        var received: String? = null
        val transport = object : CoreRuntimeTransport {
            override suspend fun sendConfigurationImport(payload: String) {
                received = payload
            }
        }
        val port = SerializedConfigImportPort(transport)

        val request = ConfigImportRequest(
            version = ConfigImportRequest.VERSION,
            source = ConfigImportRequest.Source.LOCAL_FILE,
            name = "profile.yaml",
            content = "mixed-port: 7890",
        )

        kotlinx.coroutines.runBlocking {
            port.importConfiguration(request)
        }

        assertEquals(
            ConfigImportEnvelope.serialize(request),
            received,
        )
    }
}
