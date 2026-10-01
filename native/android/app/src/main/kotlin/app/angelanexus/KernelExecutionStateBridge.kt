package app.angelanexus

/**
 * Small executable control-plane bridge between Core orchestration and a
 * platform kernel runtime.
 *
 * It deliberately does not choose a kernel or parse configuration. The caller
 * supplies the selected kernel identifier after Core has resolved the import.
 * A future native/process adapter can use this bridge without changing the UI
 * state contract.
 */
class KernelExecutionStateBridge(
    initialState: KernelExecutionState = KernelExecutionState(),
) {
    private var currentState = initialState
    private var listener: ((KernelExecutionState) -> Unit)? = null

    fun state(): KernelExecutionState = currentState

    fun setListener(listener: ((KernelExecutionState) -> Unit)?) {
        this.listener = listener
        listener?.invoke(currentState)
    }

    fun markImportReceived() {
        transition(KernelExecutionPhase.IMPORT_RECEIVED)
    }

    fun beginResolution() {
        transition(KernelExecutionPhase.RESOLVING)
    }

    fun markReady(kernelId: String) {
        require(kernelId.isNotBlank()) { "kernelId must not be blank" }
        currentState = KernelExecutionState(
            phase = KernelExecutionPhase.READY,
            kernelId = kernelId,
        )
        notifyState()
    }

    fun beginStart(kernelId: String? = currentState.kernelId) {
        currentState = currentState.copy(
            phase = KernelExecutionPhase.STARTING,
            kernelId = kernelId,
        )
        notifyState()
    }

    fun markRunning(kernelId: String? = currentState.kernelId) {
        currentState = currentState.copy(
            phase = KernelExecutionPhase.RUNNING,
            kernelId = kernelId,
            detail = null,
        )
        notifyState()
    }

    fun beginStop() {
        transition(KernelExecutionPhase.STOPPING)
    }

    fun markStopped() {
        transition(KernelExecutionPhase.STOPPED)
    }

    fun markFailure(detail: String, kernelId: String? = currentState.kernelId) {
        require(detail.isNotBlank()) { "detail must not be blank" }
        currentState = KernelExecutionState.failed(kernelId, detail)
        notifyState()
    }

    fun reset() {
        currentState = KernelExecutionState()
        notifyState()
    }

    private fun transition(phase: KernelExecutionPhase) {
        currentState = currentState.copy(phase = phase)
        notifyState()
    }

    private fun notifyState() {
        listener?.invoke(currentState)
    }
}
