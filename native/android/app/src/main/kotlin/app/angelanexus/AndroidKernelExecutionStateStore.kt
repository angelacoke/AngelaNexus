package app.angelanexus

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Process-wide platform execution state.
 *
 * The service reports facts; the UI observes them. No kernel owns application
 * state and no UI state is used as a source of truth for traffic interception.
 */
object AndroidKernelExecutionStateStore {
    private val bridge = KernelExecutionStateBridge()
    private val mutableState = MutableStateFlow(bridge.state())

    val state: StateFlow<KernelExecutionState> = mutableState.asStateFlow()

    init {
        bridge.setListener { mutableState.value = it }
    }

    fun markImportReceived() = bridge.markImportReceived()
    fun beginResolution() = bridge.beginResolution()
    fun markReady(kernelId: String) = bridge.markReady(kernelId)
    fun beginStart(kernelId: String?) = bridge.beginStart(kernelId)
    fun markRunning(kernelId: String?) = bridge.markRunning(kernelId)
    fun beginStop() = bridge.beginStop()
    fun markStopped() = bridge.markStopped()
    fun markFailure(detail: String, kernelId: String?) = bridge.markFailure(detail, kernelId)
    fun reset() = bridge.reset()
}
