package app.angelanexus

import kotlin.coroutines.Continuation
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.coroutines.startCoroutine
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CoreRuntimeBridgeTest {
    @Test
    fun unavailableBridgeReportsUnavailableAndDoesNotExecuteImport() {
        val bridge = UnavailableCoreRuntimeBridge()

        assertEquals(CoreRuntimeAvailability.UNAVAILABLE, bridge.availability())

        val error = assertFailsWith<CoreRuntimeUnavailableException> {
            runSuspend {
                bridge.importConfiguration(
                    """{"type":"angelanexus.config-import","version":1,"source":"local-file","content":"mixed-port: 7890"}""",
                )
            }
        }

        assertEquals(UnavailableCoreRuntimeBridge.DEFAULT_REASON, error.message)
    }

    @Test
    fun transportForwardsOnlyThroughAnAvailableBridge() {
        var invoked = false
        val expected = CoreRuntimeImportResult(
            source = "local-file",
            nodeCount = 1,
            kernel = "mihomo",
            detectionConfidence = "core-detected",
        )
        val bridge = object : CoreRuntimeBridge {
            override fun availability(): CoreRuntimeAvailability =
                CoreRuntimeAvailability.AVAILABLE

            override suspend fun importConfiguration(payload: String): CoreRuntimeImportResult {
                invoked = true
                assertTrue(payload.contains("angelanexus.config-import"))
                return expected
            }
        }

        val actual = runSuspend {
            NativeCoreRuntimeTransport(bridge).sendConfigurationImport(
                """{"type":"angelanexus.config-import","version":1,"source":"local-file","content":"mixed-port: 7890"}""",
            )
        }

        assertTrue(invoked)
        assertEquals(expected, actual)
        assertFalse(actual.executionIntentJson?.isBlank() == true)
    }

    @Test
    fun unavailableBridgeCannotBeBypassedByTransport() {
        val bridge = object : CoreRuntimeBridge {
            override fun availability(): CoreRuntimeAvailability =
                CoreRuntimeAvailability.UNAVAILABLE

            override suspend fun importConfiguration(payload: String): CoreRuntimeImportResult {
                error("unavailable bridge must never execute")
            }
        }

        assertFailsWith<CoreRuntimeUnavailableException> {
            runSuspend {
                NativeCoreRuntimeTransport(bridge).sendConfigurationImport(
                    """{"type":"angelanexus.config-import","version":1,"source":"local-file","content":"mixed-port: 7890"}""",
                )
            }
        }
    }

    private fun runSuspend(block: suspend () -> CoreRuntimeImportResult): CoreRuntimeImportResult {
        var result: Result<CoreRuntimeImportResult>? = null
        block.startCoroutine(
            object : Continuation<CoreRuntimeImportResult> {
                override val context = EmptyCoroutineContext
                override fun resumeWith(value: Result<CoreRuntimeImportResult>) {
                    result = value
                }
            },
        )
        return result!!.getOrThrow()
    }
}
