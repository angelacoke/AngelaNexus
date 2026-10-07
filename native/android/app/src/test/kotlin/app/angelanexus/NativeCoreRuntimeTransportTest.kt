package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class NativeCoreRuntimeTransportTest {
    @Test
    fun refusesToBypassCoreWithKernelDirectConfiguration() {
        val transport = NativeCoreRuntimeTransport()

        val error = assertFailsWith<CoreRuntimeUnavailableException> {
            runSuspend {
                transport.sendConfigurationImport(
                    """{"type":"angelanexus.config-import","version":1,"source":"local-file","content":"proxies: []"}""",
                )
            }
        }

        assertEquals(
            NativeCoreRuntimeTransport.DEFAULT_UNAVAILABLE_REASON,
            error.message,
        )
    }

    private fun runSuspend(block: suspend () -> CoreRuntimeImportResult): CoreRuntimeImportResult {
        var result: Result<CoreRuntimeImportResult>? = null
        block.startCoroutine(object : kotlin.coroutines.Continuation<CoreRuntimeImportResult> {
            override val context = kotlin.coroutines.EmptyCoroutineContext
            override fun resumeWith(value: Result<CoreRuntimeImportResult>) {
                result = value
            }
        })
        return result!!.getOrThrow()
    }
}
