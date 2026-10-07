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
    val candidates: List<String>,
    val reason: KernelDriverSelectionReason,
)

enum class KernelDriverSelectionReason {
    PREFERRED_MATCH,
    FIRST_CAPABILITY_MATCH,
    PREFERRED_UNAVAILABLE_FALLBACK,
}

class KernelDriverScheduler(
    private val drivers: List<AndroidKernelDriver>,
) {
    fun select(intent: KernelExecutionIntent): KernelDriverSelection {
        val preferred = intent.preferredKernelId
            ?.trim()
            ?.lowercase()
            ?.takeIf { it.isNotEmpty() }
        val candidates = KernelCapabilityRegistry.profiles(drivers)
            .filter { profile ->
                profile.available &&
                    profile.capabilities.containsAll(intent.requiredCapabilities)
            }
        val selected = if (preferred != null) {
            candidates.firstOrNull { it.kernelId.trim().lowercase() == preferred }
        } else {
            null
        }

        val chosen = selected ?: candidates.firstOrNull()
        val reason = when {
            selected != null -> KernelDriverSelectionReason.PREFERRED_MATCH
            preferred != null -> KernelDriverSelectionReason.PREFERRED_UNAVAILABLE_FALLBACK
            else -> KernelDriverSelectionReason.FIRST_CAPABILITY_MATCH
        }

        chosen ?: throw IllegalStateException(
            "No available kernel driver satisfies required capabilities: " +
                intent.requiredCapabilities.joinToString(","),
        )

        return KernelDriverSelection(
            kernelId = chosen.kernelId,
            capabilities = chosen.capabilities,
            candidates = candidates.map { it.kernelId },
            reason = reason,
        )
    }
}
