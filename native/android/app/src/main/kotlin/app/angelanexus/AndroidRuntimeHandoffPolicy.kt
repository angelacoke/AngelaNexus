package app.angelanexus

/**
 * A Core import is launchable on Android only when it produced the complete,
 * canonical handoff expected by the VPN service. The platform never fills in
 * missing configuration or execution policy on the user's behalf.
 */
internal fun CoreRuntimeImportResult?.hasCompleteAndroidExecutionHandoff(): Boolean {
    val result = this ?: return false
    if (result.kernel.isNullOrBlank() || result.configuration.isNullOrBlank()) return false
    val serializedIntent = result.executionIntentJson ?: return false
    return runCatching { AndroidRoutingExecutionIntent.parse(serializedIntent) }.isSuccess
}

internal fun canStartAndroidRuntime(
    state: KernelExecutionState,
    importResult: CoreRuntimeImportResult?,
): Boolean {
    val lifecycleAllowsStart = when (state.phase) {
        KernelExecutionPhase.IDLE,
        KernelExecutionPhase.READY,
        KernelExecutionPhase.STOPPED -> true
        KernelExecutionPhase.FAILED -> !state.cleanupRequired
        KernelExecutionPhase.IMPORT_RECEIVED,
        KernelExecutionPhase.RESOLVING,
        KernelExecutionPhase.STARTING,
        KernelExecutionPhase.RUNNING,
        KernelExecutionPhase.STOPPING -> false
    }
    return lifecycleAllowsStart && importResult.hasCompleteAndroidExecutionHandoff()
}
