package app.angelanexus

import kotlin.coroutines.Continuation
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.coroutines.startCoroutine
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SerializedConfigImportPortTest {
    @Test
    fun forwardsSerializedEnvelopeAndReturnsCoreResult() {
        var received: String? = null
        val expected = CoreRuntimeImportResult("local-file", 1, "mihomo", "detected")
        val transport = object : CoreRuntimeTransport {
            override suspend fun sendConfigurationImport(payload: String): CoreRuntimeImportResult {
                received = payload
                return expected
            }
        }
        val port = SerializedConfigImportPort(transport)

        val request = ConfigImportRequest(
            version = ConfigImportRequest.VERSION,
            source = ConfigImportRequest.Source.LOCAL_FILE,
            name = "profile.yaml",
            content = "mixed-port: 7890",
        )

        var completed = false
        var failure: Throwable? = null
        var actual: CoreRuntimeImportResult? = null
        suspend { actual = port.importConfiguration(request) }.startCoroutine(
            object : Continuation<Unit> {
                override val context = EmptyCoroutineContext
                override fun resumeWith(result: Result<Unit>) {
                    failure = result.exceptionOrNull()
                    completed = true
                }
            },
        )

        assertTrue(completed)
        failure?.let { throw it }
        assertEquals(ConfigImportEnvelope.serialize(request), received)
        assertEquals(expected, actual)
    }
}
