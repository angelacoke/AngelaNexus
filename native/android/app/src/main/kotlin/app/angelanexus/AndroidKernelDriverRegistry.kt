package app.angelanexus

import android.content.Context

object AndroidKernelDriverRegistry {
    fun all(context: Context): List<AndroidKernelDriver> = listOf(
        MihomoAndroidKernelDriver(MihomoNativeRuntimeFactory.create(context)),
        UnsupportedAndroidKernelDriver("sing-box"),
        UnsupportedAndroidKernelDriver("xray"),
    )

    fun resolve(context: Context, kernelId: String?): AndroidKernelDriver {
        val id = kernelId?.trim()?.lowercase()
            ?: throw IllegalArgumentException("kernel identity is required")
        return all(context).firstOrNull { it.id == id }
            ?: throw IllegalArgumentException("unsupported Android kernel driver: $id")
    }
}

private class UnsupportedAndroidKernelDriver(
    override val id: String,
) : AndroidKernelDriver {
    override val capabilities: Set<String> = emptySet()

    private fun unsupported(): Nothing =
        throw UnsupportedOperationException(
            "Android $id driver is registered in the parallel execution registry but its native runtime is not yet available"
        )

    override fun initialize(homeDir: String) = unsupported()
    override fun applyConfiguration(configuration: String) = unsupported()
    override fun attachTun(tunFd: Int, policy: AndroidVpnRuntimePolicy) = unsupported()
    override fun start() = unsupported()
    override fun stop() = Unit
    override fun status(): AndroidKernelDriverStatus =
        AndroidKernelDriverStatus(id, running = false, detail = "native runtime unavailable")
}
