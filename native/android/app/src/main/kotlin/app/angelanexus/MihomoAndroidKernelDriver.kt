package app.angelanexus

import java.io.File
import org.json.JSONObject

class MihomoAndroidKernelDriver(
    private val runtime: MihomoNativeHost,
) : AndroidKernelDriver {
    override val id: String = "mihomo"

    override val capabilities: Set<String> = setOf(
        AndroidKernelDriverCapabilities.CONFIG_APPLY,
        AndroidKernelDriverCapabilities.TUN_ATTACH,
        AndroidKernelDriverCapabilities.START_STOP,
        AndroidKernelDriverCapabilities.STATUS,
    )

    private var initialized = false
    private var attached = false
    private var running = false

    override fun preparePlatform(service: android.net.VpnService) {
        runtime.setVpnService(service)
    }

    override fun initialize(homeDir: String) {
        runtime.initialize(File(homeDir).absolutePath)
        initialized = true
    }

    override fun applyConfiguration(configuration: String) {
        check(initialized) { "Mihomo driver is not initialized" }
        val error = runtime.applyConfig(configuration)
        if (!error.isNullOrEmpty()) {
            throw IllegalStateException("Mihomo rejected configuration: $error")
        }
    }

    override fun attachTun(tunFd: Int, policy: AndroidVpnRuntimePolicy) {
        check(initialized) { "Mihomo driver is not initialized" }
        check(!attached) { "Mihomo TUN is already attached" }
        require(tunFd >= 0) { "tunFd must be non-negative" }
        check(runtime.hasVpnProtector()) {
            "Android VpnService protector is unavailable"
        }
        check(runtime.startTun(
            tunFd = tunFd,
            stack = policy.stack,
            address = policy.addresses.joinToString(","),
            dns = policy.dnsHijack,
        )) {
            "Mihomo failed to bind the Android TUN descriptor"
        }
        attached = true
    }

    override fun start() {
        check(attached) { "Mihomo driver has no attached TUN" }
        check(!running) { "Mihomo driver is already running" }
        running = true
    }

    override fun stop() {
        // Preserve the native/runtime state when stopping fails so the
        // service lifecycle can recover instead of observing a false idle state.
        runtime.stopTun()
        attached = false
        running = false
        runtime.clearVpnService()
    }

    override fun status(): AndroidKernelDriverStatus {
        if (running) {
            val trafficSnapshot = runtime.getTraffic(false)
            try {
                JSONObject(trafficSnapshot)
            } catch (error: Exception) {
                throw IllegalStateException(
                    "Mihomo native runtime health check returned invalid traffic state",
                    error,
                )
            }
        }
        return AndroidKernelDriverStatus(id, running, if (attached) "TUN attached" else "idle")
    }
}
