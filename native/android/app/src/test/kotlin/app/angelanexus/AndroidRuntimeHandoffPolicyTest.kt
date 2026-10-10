package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AndroidRuntimeHandoffPolicyTest {
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
    fun executableHandoffRequiresProxyModeAndARegisteredAndroidKernel() {
        val proxy = CoreRuntimeImportResult(
            source = "local-file",
            nodeCount = 1,
            kernel = "mihomo",
            detectionConfidence = "explicit",
            configuration = "mixed-port: 7890",
            executionIntentJson = """{"version":1,"kind":"routing-execution-intent","mode":"proxy","action":"route","target":"node-1"}""",
        )

        assertTrue(proxy.hasExecutableAndroidExecutionHandoff())
        for (kernel in setOf("mihomo", "sing-box", "xray")) {
            assertTrue(proxy.copy(kernel = kernel).hasExecutableAndroidExecutionHandoff())
        }
        assertFalse(proxy.copy(kernel = "unknown-kernel").hasExecutableAndroidExecutionHandoff())

        val unsupportedIntents = listOf(
            """{"version":1,"kind":"routing-execution-intent","mode":"direct","action":"bypass","target":"all"}""",
            """{"version":1,"kind":"routing-execution-intent","mode":"reject","action":"reject"}""",
            """{"version":1,"kind":"routing-execution-intent","mode":"chain","action":"chain","hops":["node-1","node-2"]}""",
            """{"version":1,"kind":"routing-execution-intent","mode":"dns","action":"dns","target":"resolver-1"}""",
        )
        for (intent in unsupportedIntents) {
            val result = proxy.copy(executionIntentJson = intent)
            assertTrue(result.hasCompleteAndroidExecutionHandoff())
            assertFalse(result.hasExecutableAndroidExecutionHandoff())
            assertFalse(canStartAndroidRuntime(KernelExecutionState(), result))
        }
    }

    @Test
    fun startGateRequiresACompleteHandoffAndARecoverableLifecyclePhase() {
        val complete = CoreRuntimeImportResult(
            source = "local-file",
            nodeCount = 1,
            kernel = "mihomo",
            detectionConfidence = "explicit",
            configuration = "mixed-port: 7890",
            executionIntentJson = """{"version":1,"kind":"routing-execution-intent","mode":"proxy","action":"route","target":"node-1"}""",
        )

        assertTrue(canStartAndroidRuntime(KernelExecutionState(), complete))
        assertTrue(canStartAndroidRuntime(KernelExecutionState(), complete.copy(kernel = "sing-box")))
        assertTrue(canStartAndroidRuntime(KernelExecutionState(), complete.copy(kernel = "xray")))
        assertFalse(canStartAndroidRuntime(KernelExecutionState(), complete.copy(kernel = "unknown-kernel")))
        assertTrue(
            canStartAndroidRuntime(
                KernelExecutionState(phase = KernelExecutionPhase.STOPPED),
                complete,
            ),
        )
        assertTrue(
            canStartAndroidRuntime(
                KernelExecutionState(phase = KernelExecutionPhase.FAILED),
                complete,
            ),
        )
        assertFalse(
            canStartAndroidRuntime(
                KernelExecutionState(phase = KernelExecutionPhase.FAILED, cleanupRequired = true),
                complete,
            ),
        )
        assertFalse(
            canStartAndroidRuntime(
                KernelExecutionState(phase = KernelExecutionPhase.RUNNING),
                complete,
            ),
        )
        assertFalse(canStartAndroidRuntime(KernelExecutionState(), null))
    }
}
