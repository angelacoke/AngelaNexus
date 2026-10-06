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
        transition(KernelExecutionPhase.READY, kernelId = kernelId, detail = null)
    }

    fun beginStart(kernelId: String? = currentState.kernelId) {
        transition(KernelExecutionPhase.STARTING, kernelId = kernelId)
    }

    fun markRunning(kernelId: String? = currentState.kernelId) {
        transition(KernelExecutionPhase.RUNNING, kernelId = kernelId, detail = null)
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

    private fun transition(
        phase: KernelExecutionPhase,
        kernelId: String? = currentState.kernelId,
        detail: String? = currentState.detail,
    ) {
        check(isTransitionAllowed(currentState.phase, phase)) {
            "invalid kernel execution state transition: " +
                currentState.phase + " -> " + phase
        }
        currentState = currentState.copy(
            phase = phase,
            kernelId = kernelId,
            detail = detail,
        )
        notifyState()
    }

    private fun isTransitionAllowed(
        from: KernelExecutionPhase,
        to: KernelExecutionPhase,
    ): Boolean {
        return when (from) {
            KernelExecutionPhase.IDLE ->
                to == KernelExecutionPhase.IMPORT_RECEIVED ||
                    to == KernelExecutionPhase.FAILED
            KernelExecutionPhase.IMPORT_RECEIVED ->
                to == KernelExecutionPhase.RESOLVING ||
                    to == KernelExecutionPhase.FAILED
            KernelExecutionPhase.RESOLVING ->
                to == KernelExecutionPhase.READY ||
                    to == KernelExecutionPhase.FAILED
            KernelExecutionPhase.READY ->
                to == KernelExecutionPhase.STARTING ||
                    to == KernelExecutionPhase.STOPPING ||
                    to == KernelExecutionPhase.FAILED
            KernelExecutionPhase.STARTING ->
                to == KernelExecutionPhase.RUNNING ||
                    to == KernelExecutionPhase.FAILED ||
                    to == KernelExecutionPhase.STOPPING
            KernelExecutionPhase.RUNNING ->
                to == KernelExecutionPhase.STOPPING ||
                    to == KernelExecutionPhase.FAILED
            KernelExecutionPhase.STOPPING ->
                to == KernelExecutionPhase.STOPPED ||
                    to == KernelExecutionPhase.FAILED
            KernelExecutionPhase.STOPPED ->
                to == KernelExecutionPhase.IMPORT_RECEIVED ||
                    to == KernelExecutionPhase.IDLE
            KernelExecutionPhase.FAILED ->
                to == KernelExecutionPhase.IMPORT_RECEIVED ||
                    to == KernelExecutionPhase.IDLE
        }
    }

    private fun notifyState() {
        listener?.invoke(currentState)
    }
}
