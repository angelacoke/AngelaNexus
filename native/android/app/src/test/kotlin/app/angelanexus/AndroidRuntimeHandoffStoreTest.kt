package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class AndroidRuntimeHandoffStoreTest {
    private val allProxyKernels = setOf("mihomo", "sing-box", "xray")
    private val nonMihomoProxyKernels = setOf("sing-box", "xray")

    @Test
    fun handoffIsConsumedExactlyOnceAndWrongTokenDoesNotConsumeIt() {
        val result = validResult()
        val token = AndroidRuntimeHandoffStore.publish(result, allProxyKernels)

        assertNull(AndroidRuntimeHandoffStore.consume("wrong-token"))
        assertEquals(result.configuration, AndroidRuntimeHandoffStore.consume(token)?.configuration)
        assertNull(AndroidRuntimeHandoffStore.consume(token))
    }

    @Test
    fun replacingOrDiscardingUsesTokenIdentity() {
        val oldToken = AndroidRuntimeHandoffStore.publish(validResult("old-config"), allProxyKernels)
        val newToken = AndroidRuntimeHandoffStore.publish(validResult("new-config"), allProxyKernels)

        AndroidRuntimeHandoffStore.discard(oldToken)
        assertEquals("new-config", AndroidRuntimeHandoffStore.consume(newToken)?.configuration)
        assertNull(AndroidRuntimeHandoffStore.consume(oldToken))
    }

    @Test
    fun unsupportedCoreModeCannotBePublishedForVpnStartup() {
        val unsupported = validResult().copy(
            executionIntentJson = """{"version":1,"kind":"routing-execution-intent","mode":"direct","action":"bypass","target":"all"}""",
        )

        assertFailsWith<IllegalArgumentException> {
            AndroidRuntimeHandoffStore.publish(unsupported, allProxyKernels)
        }
    }

    @Test
    fun unavailableNativeRuntimeCannotBePublishedForVpnStartup() {
        assertFailsWith<IllegalArgumentException> {
            AndroidRuntimeHandoffStore.publish(validResult(), nonMihomoProxyKernels)
        }
    }

    private fun validResult(
        configuration: String = "mixed-port: 7890",
        kernel: String = "mihomo",
    ) = CoreRuntimeImportResult(
        source = "local-file",
        nodeCount = 1,
        kernel = kernel,
        detectionConfidence = "explicit",
        configuration = configuration,
        executionIntentJson = """{"version":1,"kind":"routing-execution-intent","mode":"proxy","action":"route","target":"node-1"}""",
    )
}
