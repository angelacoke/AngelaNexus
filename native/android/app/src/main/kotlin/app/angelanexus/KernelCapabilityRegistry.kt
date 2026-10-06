package app.angelanexus

data class KernelCapabilityProfile(
    val kernelId: String,
    val capabilities: Set<String>,
    val available: Boolean,
)

object KernelCapabilityRegistry {
    fun profiles(drivers: List<AndroidKernelDriver>): List<KernelCapabilityProfile> =
        drivers.map { driver ->
            val status = runCatching { driver.status() }.getOrNull()
            KernelCapabilityProfile(
                kernelId = driver.id,
                capabilities = driver.capabilities,
                available = status != null && driver.capabilities.isNotEmpty(),
                status = status,
            )
        }
}