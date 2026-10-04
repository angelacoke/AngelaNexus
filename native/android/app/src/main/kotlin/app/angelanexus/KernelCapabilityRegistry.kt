package app.angelanexus

data class KernelCapabilityProfile(
    val kernelId: String,
    val capabilities: Set<String>,
    val available: Boolean,
)

object KernelCapabilityRegistry {
    fun profiles(drivers: List<AndroidKernelDriver>): List<KernelCapabilityProfile> =
        drivers.map {
            KernelCapabilityProfile(
                kernelId = it.id,
                capabilities = it.capabilities,
                available = it.capabilities.isNotEmpty(),
            )
        }
}