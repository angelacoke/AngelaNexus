package app.angelanexus

/**
 * A Core import is structurally complete when it produced the canonical
 * handoff. The platform never fills in missing configuration or execution
 * policy on the user's behalf.
 */
internal fun CoreRuntimeImportResult?.hasCompleteAndroidExecutionHandoff(): Boolean {
    val result = this ?: return false
    if (result.kernel.isNullOrBlank() || result.configuration.isNullOrBlank()) return false
    val serializedIntent = result.executionIntentJson ?: return false
    return runCatching { AndroidRoutingExecutionIntent.parse(serializedIntent) }.isSuccess
}

/**
 * Android currently executes only proxy-mode intents with a driver whose
 * runtime artifact is available in this installation. Other valid Core intents
 * remain inspectable but cannot be started through the Android VPN UI.
 */
internal fun CoreRuntimeImportResult?.hasExecutableAndroidExecutionHandoff(
    availableProxyKernelIds: Set<String>,
): Boolean {
    val result = this ?: return false
    if (!result.hasCompleteAndroidExecutionHandoff()) return false
    val serializedIntent = result.executionIntentJson ?: return false
    val intent = runCatching { AndroidRoutingExecutionIntent.parse(serializedIntent) }
        .getOrNull() ?: return false
    return intent.mode == "proxy" &&
        AndroidKernelDriverRegistry.supportsProxyExecution(result.kernel, availableProxyKernelIds)
}

internal fun canStartAndroidRuntime(
    state: KernelExecutionState,
    importResult: CoreRuntimeImportResult?,
    availableProxyKernelIds: Set<String>,
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
    return lifecycleAllowsStart &&
        importResult.hasExecutableAndroidExecutionHandoff(availableProxyKernelIds)
}
