package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AndroidRuntimeHandoffPolicyTest {
    private val allProxyKernels = setOf("mihomo", "sing-box", "xray")
    private val nonMihomoProxyKernels = setOf("sing-box", "xray")

    @Test
    fun requiresCoreSelectedKernelConfigurationAndExecutionIntent() {
        val complete = CoreRuntimeImportResult(
            source = "local-file",
            nodeCount = 1,
            kernel = "mihomo",
            detectionConfidence = "explicit",
            configuration = "mixed-port: 7890",
            executionIntentJson = """{"version":1,"kind":"routing-execution-intent","mode":"proxy","action":"route","target":"node-1"}""",
        )
        assertTrue(complete.hasCompleteAndroidExecutionHandoff())

        assertFalse(null.hasCompleteAndroidExecutionHandoff())
        assertFalse(complete.copy(kernel = null).hasCompleteAndroidExecutionHandoff())
        assertFalse(complete.copy(configuration = " ").hasCompleteAndroidExecutionHandoff())
        assertFalse(complete.copy(executionIntentJson = null).hasCompleteAndroidExecutionHandoff())
        assertFalse(complete.copy(executionIntentJson = "not-json").hasCompleteAndroidExecutionHandoff())
        assertFalse(
            complete.copy(executionIntentJson = """{"version":1,"kind":"routing-execution-intent","mode":"proxy","action":"bypass","target":"node-1"}""")
                .hasCompleteAndroidExecutionHandoff(),
        )
    }

    @Test
    fun executableHandoffRequiresProxyModeAndAnAvailableAndroidKernel() {
        val proxy = CoreRuntimeImportResult(
            source = "local-file",
            nodeCount = 1,
            kernel = "mihomo",
            detectionConfidence = "explicit",
            configuration = "mixed-port: 7890",
            executionIntentJson = """{"version":1,"kind":"routing-execution-intent","mode":"proxy","action":"route","target":"node-1"}""",
        )

        assertTrue(proxy.hasExecutableAndroidExecutionHandoff(allProxyKernels))
        for (kernel in allProxyKernels) {
            assertTrue(proxy.copy(kernel = kernel).hasExecutableAndroidExecutionHandoff(allProxyKernels))
        }
        assertFalse(proxy.copy(kernel = "unknown-kernel").hasExecutableAndroidExecutionHandoff(allProxyKernels))
        assertFalse(proxy.hasExecutableAndroidExecutionHandoff(nonMihomoProxyKernels))

        val unsupportedIntents = listOf(
            """{"version":1,"kind":"routing-execution-intent","mode":"direct","action":"bypass","target":"all"}""",
            """{"version":1,"kind":"routing-execution-intent","mode":"reject","action":"reject"}""",
            """{"version":1,"kind":"routing-execution-intent","mode":"chain","action":"chain","hops":["node-1","node-2"]}""",
            """{"version":1,"kind":"routing-execution-intent","mode":"dns","action":"dns","target":"resolver-1"}""",
        )
        for (intent in unsupportedIntents) {
            val result = proxy.copy(executionIntentJson = intent)
            assertTrue(result.hasCompleteAndroidExecutionHandoff())
            assertFalse(result.hasExecutableAndroidExecutionHandoff(allProxyKernels))
            assertFalse(canStartAndroidRuntime(KernelExecutionState(), result, allProxyKernels))
        }
    }

    @Test
    fun startGateRequiresACompleteHandoffAvailableKernelAndRecoverableLifecyclePhase() {
        val complete = CoreRuntimeImportResult(
            source = "local-file",
            nodeCount = 1,
            kernel = "mihomo",
            detectionConfidence = "explicit",
            configuration = "mixed-port: 7890",
            executionIntentJson = """{"version":1,"kind":"routing-execution-intent","mode":"proxy","action":"route","target":"node-1"}""",
        )

        assertTrue(canStartAndroidRuntime(KernelExecutionState(), complete, allProxyKernels))
        assertTrue(canStartAndroidRuntime(KernelExecutionState(), complete.copy(kernel = "sing-box"), nonMihomoProxyKernels))
        assertTrue(canStartAndroidRuntime(KernelExecutionState(), complete.copy(kernel = "xray"), nonMihomoProxyKernels))
        assertFalse(canStartAndroidRuntime(KernelExecutionState(), complete, nonMihomoProxyKernels))
        assertFalse(canStartAndroidRuntime(KernelExecutionState(), complete.copy(kernel = "unknown-kernel"), allProxyKernels))
        assertTrue(
            canStartAndroidRuntime(
                KernelExecutionState(phase = KernelExecutionPhase.STOPPED),
                complete,
                allProxyKernels,
            ),
        )
        assertTrue(
            canStartAndroidRuntime(
                KernelExecutionState(phase = KernelExecutionPhase.FAILED),
                complete,
                allProxyKernels,
            ),
        )
        assertFalse(
            canStartAndroidRuntime(
                KernelExecutionState(phase = KernelExecutionPhase.FAILED, cleanupRequired = true),
                complete,
                allProxyKernels,
            ),
        )
        assertFalse(
            canStartAndroidRuntime(
                KernelExecutionState(phase = KernelExecutionPhase.RUNNING),
                complete,
                allProxyKernels,
            ),
        )
        assertFalse(canStartAndroidRuntime(KernelExecutionState(), null, allProxyKernels))
    }
}
