package app.angelanexus

/**
 * Stable Android-facing execution state for the kernel-neutral runtime bridge.
 *
 * The state belongs to the platform control plane. Kernel implementations only
 * report lifecycle transitions and do not own application UI state.
 */
enum class KernelExecutionPhase {
    IDLE,
    IMPORT_RECEIVED,
    RESOLVING,
    READY,
    STARTING,
    RUNNING,
    STOPPING,
    STOPPED,
    FAILED,
}

data class KernelExecutionState(
    val phase: KernelExecutionPhase = KernelExecutionPhase.IDLE,
    val kernelId: String? = null,
    val detail: String? = null,
) {
    companion object {
        fun failed(kernelId: String?, detail: String): KernelExecutionState =
            KernelExecutionState(
                phase = KernelExecutionPhase.FAILED,
                kernelId = kernelId,
                detail = detail,
            )
    }
}
