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
