package app.angelanexus

/**
 * Platform-neutral Android execution contract for a kernel driver.
 *
 * Android owns interception policy and TUN establishment. Drivers own only
 * kernel lifecycle and execution against the platform-dispatched intent.
 */
interface AndroidKernelDriver {
    val id: String
    val capabilities: Set<String>

    fun initialize(homeDir: String)
    fun applyConfiguration(configuration: String)
    fun attachTun(tunFd: Int, policy: AndroidVpnRuntimePolicy)
    fun start()
    fun stop()
    fun status(): AndroidKernelDriverStatus
}

data class AndroidKernelDriverStatus(
    val driverId: String,
    val running: Boolean,
    val detail: String? = null,
)

object AndroidKernelDriverCapabilities {
    const val CONFIG_APPLY = "config-apply"
    const val TUN_ATTACH = "tun-attach"
    const val START_STOP = "start-stop"
    const val STATUS = "status"
}
