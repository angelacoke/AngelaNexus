package app.angelanexus

data class KernelExecutionIntent(
    val preferredKernelId: String? = null,
    val requiredCapabilities: Set<String> = setOf(
        AndroidKernelDriverCapabilities.CONFIG_APPLY,
        AndroidKernelDriverCapabilities.TUN_ATTACH,
        AndroidKernelDriverCapabilities.START_STOP,
        AndroidKernelDriverCapabilities.STATUS,
    ),
)

data class KernelDriverSelection(
    val kernelId: String,
    val capabilities: Set<String>,
)

class KernelDriverScheduler(
    private val drivers: List<AndroidKernelDriver>,
) {
    fun select(intent: KernelExecutionIntent): KernelDriverSelection {
        val preferred = intent.preferredKernelId?.trim()?.lowercase()
        val candidates = drivers.filter { driver ->
            driver.capabilities.containsAll(intent.requiredCapabilities)
        }
        val selected = if (preferred != null) {
            candidates.firstOrNull { it.id == preferred }
        } else {
            candidates.firstOrNull()
        } ?: throw IllegalStateException(
            "No kernel driver satisfies required capabilities: " + intent.requiredCapabilities.joinToString(",")
        )
        return KernelDriverSelection(selected.id, selected.capabilities)
    }
}