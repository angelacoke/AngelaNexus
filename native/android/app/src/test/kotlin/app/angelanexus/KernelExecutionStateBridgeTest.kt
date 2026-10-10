package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class KernelExecutionStateBridgeTest {
    @Test
    fun lifecycleTransitionsAreObservable() {
        val bridge = KernelExecutionStateBridge()
        val states = mutableListOf<KernelExecutionState>()
        bridge.setListener(states::add)

        bridge.markImportReceived()
        bridge.beginResolution()
        bridge.markReady("mihomo")
        bridge.beginStart()
        bridge.markRunning()
        bridge.beginStop()
        bridge.markStopped()

        assertEquals(KernelExecutionPhase.IDLE, states.first().phase)
        assertEquals(KernelExecutionPhase.RUNNING, states[5].phase)
        assertEquals(KernelExecutionPhase.STOPPED, states.last().phase)
        assertEquals("mihomo", bridge.state().kernelId)
    }

    @Test
    fun vpnServiceCanStartFromIdleAndReconnectAfterVerifiedStop() {
        val bridge = KernelExecutionStateBridge()

        bridge.beginStart("mihomo")
        bridge.markRunning()
        bridge.beginStop()
        bridge.markStopped()
        bridge.beginStart("mihomo")

        assertEquals(KernelExecutionPhase.STARTING, bridge.state().phase)
        assertEquals("mihomo", bridge.state().kernelId)
        assertEquals(false, bridge.state().cleanupRequired)
    }

    @Test
    fun invalidLifecycleTransitionsAreRejected() {
        val bridge = KernelExecutionStateBridge()

        assertFailsWith<IllegalStateException> {
            bridge.markStopped()
        }

        bridge.markImportReceived()
        assertFailsWith<IllegalStateException> {
            bridge.markRunning()
        }
    }

    @Test
    fun failureCannotBypassLifecycleGuardFromStopped() {
        val bridge = KernelExecutionStateBridge()
        bridge.markImportReceived()
        bridge.beginResolution()
        bridge.markReady("mihomo")
        bridge.beginStop()
        bridge.markStopped()

        assertFailsWith<IllegalStateException> {
            bridge.markFailure("unexpected failure")
        }
        assertEquals(KernelExecutionPhase.STOPPED, bridge.state().phase)
    }

    @Test
    fun failedAndStoppedStatesCanStartAnewImport() {
        val bridge = KernelExecutionStateBridge()

        bridge.markImportReceived()
        bridge.beginResolution()
        bridge.markFailure("resolution failed")
        bridge.markImportReceived()
        assertEquals(KernelExecutionPhase.IMPORT_RECEIVED, bridge.state().phase)

        bridge.beginResolution()
        bridge.markReady("mihomo")
        bridge.beginStop()
        bridge.markStopped()
        bridge.markImportReceived()
        assertEquals(KernelExecutionPhase.IMPORT_RECEIVED, bridge.state().phase)
    }

    @Test
    fun failurePreservesSelectedKernelAndReason() {
        val bridge = KernelExecutionStateBridge()
        bridge.markImportReceived()
        bridge.beginResolution()
        bridge.markReady("mihomo")

        bridge.markFailure("native runtime unavailable")

        assertEquals(KernelExecutionPhase.FAILED, bridge.state().phase)
        assertEquals("mihomo", bridge.state().kernelId)
        assertEquals("native runtime unavailable", bridge.state().detail)
    }

    @Test
    fun cleanFailureCanBeRetriedButUnverifiedCleanupMustBeRetriedFirst() {
        val cleanFailure = KernelExecutionStateBridge()
        cleanFailure.markFailure("runtime failed", "mihomo")
        cleanFailure.beginStart("mihomo")
        assertEquals(KernelExecutionPhase.STARTING, cleanFailure.state().phase)

        val cleanupFailure = KernelExecutionStateBridge()
        cleanupFailure.markFailure("stop failed", "mihomo", cleanupRequired = true)
        assertFailsWith<IllegalStateException> {
            cleanupFailure.beginStart("mihomo")
        }

        cleanupFailure.beginStop()
        cleanupFailure.markFailure("stop still failed", "mihomo", cleanupRequired = true)
        cleanupFailure.beginStop()
        cleanupFailure.markStopped()
        cleanupFailure.beginStart("mihomo")

        assertEquals(KernelExecutionPhase.STARTING, cleanupFailure.state().phase)
        assertEquals(false, cleanupFailure.state().cleanupRequired)
    }

    @Test
    fun blankKernelIdAndFailureDetailAreRejected() {
        val bridge = KernelExecutionStateBridge()

        assertFailsWith<IllegalArgumentException> {
            bridge.markReady(" ")
        }
        assertFailsWith<IllegalArgumentException> {
            bridge.markFailure("")
        }
        assertNull(bridge.state().kernelId)
    }
}
