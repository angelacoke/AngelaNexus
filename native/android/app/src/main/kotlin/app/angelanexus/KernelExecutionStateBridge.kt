package app.angelanexus

/**
 * Small executable control-plane bridge between Core orchestration and a
 * Android VPN service and UI.
 *
 * It deliberately does not choose a kernel or parse configuration. The caller
 * supplies the selected kernel identifier after Core has resolved the import.
 * It keeps platform execution state separate from routing policy and exposes one
 * contract for the service lifecycle and the UI.
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
        check(!currentState.cleanupRequired) {
            "cannot import a new configuration while runtime cleanup is unverified"
        }
        transition(KernelExecutionPhase.IMPORT_RECEIVED, cleanupRequired = false)
    }

    fun beginResolution() {
        transition(KernelExecutionPhase.RESOLVING)
    }

    fun markReady(kernelId: String) {
        require(kernelId.isNotBlank()) { "kernelId must not be blank" }
        transition(
            KernelExecutionPhase.READY,
            kernelId = kernelId,
            detail = null,
            cleanupRequired = false,
        )
    }

    fun beginStart(kernelId: String? = currentState.kernelId) {
        check(!currentState.cleanupRequired) {
            "cannot start a new runtime while cleanup is unverified"
        }
        transition(
            KernelExecutionPhase.STARTING,
            kernelId = kernelId,
            detail = null,
            cleanupRequired = false,
        )
    }

    fun markRunning(kernelId: String? = currentState.kernelId) {
        transition(
            KernelExecutionPhase.RUNNING,
            kernelId = kernelId,
            detail = null,
            cleanupRequired = false,
        )
    }

    fun beginStop() {
        if (currentState.phase != KernelExecutionPhase.STOPPING) {
            transition(KernelExecutionPhase.STOPPING)
        }
    }

    fun markStopped() {
        transition(KernelExecutionPhase.STOPPED, cleanupRequired = false)
    }

    fun markFailure(
        detail: String,
        kernelId: String? = currentState.kernelId,
        cleanupRequired: Boolean = false,
    ) {
        require(detail.isNotBlank()) { "detail must not be blank" }
        transition(
            KernelExecutionPhase.FAILED,
            kernelId = kernelId,
            detail = detail,
            cleanupRequired = cleanupRequired,
        )
    }

    fun reset() {
        currentState = KernelExecutionState()
        notifyState()
    }

    private fun transition(
        phase: KernelExecutionPhase,
        kernelId: String? = currentState.kernelId,
        detail: String? = currentState.detail,
        cleanupRequired: Boolean = currentState.cleanupRequired,
    ) {
        check(isTransitionAllowed(currentState.phase, phase)) {
            "invalid kernel execution state transition: " +
                currentState.phase + " -> " + phase
        }
        currentState = currentState.copy(
            phase = phase,
            kernelId = kernelId,
            detail = detail,
            cleanupRequired = cleanupRequired,
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
                    to == KernelExecutionPhase.STARTING ||
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
                    to == KernelExecutionPhase.STARTING ||
                    to == KernelExecutionPhase.IDLE
            KernelExecutionPhase.FAILED ->
                to == KernelExecutionPhase.IMPORT_RECEIVED ||
                    to == KernelExecutionPhase.STARTING ||
                    to == KernelExecutionPhase.STOPPING ||
                    to == KernelExecutionPhase.STOPPED ||
                    to == KernelExecutionPhase.FAILED ||
                    to == KernelExecutionPhase.IDLE
        }
    }

    private fun notifyState() {
        listener?.invoke(currentState)
    }
}
