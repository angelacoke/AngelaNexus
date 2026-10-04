package app.angelanexus

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.os.ResultReceiver

/**
 * Android system-VPN data-plane boundary.
 *
 * This service owns only Android interception mechanics: TUN lifecycle,
 * addresses/routes/DNS, foreground lifetime, and failure reporting. It does
 * not select a kernel and does not reinterpret routing policy.
 */
class AngelaNexusVpnService : VpnService() {
    companion object {
        const val ACTION_START = AndroidVpnRuntimeProtocol.ACTION_START
        const val ACTION_STOP = AndroidVpnRuntimeProtocol.ACTION_STOP
        const val EXTRA_KERNEL_ID = AndroidVpnRuntimeProtocol.EXTRA_KERNEL_ID
        const val EXTRA_CONFIGURATION = "app.angelanexus.vpn.CONFIGURATION"

        private const val CHANNEL_ID = "angelanexus-vpn"
        private const val NOTIFICATION_ID = 1001
        private const val DEFAULT_IPV4_ADDRESS = "10.231.0.2"
        private const val DEFAULT_IPV4_PREFIX = 32
        private const val DEFAULT_SESSION = "AngelaNexus"

        private const val KEY_IPV4_ADDRESS = AndroidVpnRuntimeProtocol.EXTRA_IPV4_ADDRESS
    }

    private var tun: ParcelFileDescriptor? = null
    private var activeKernel: String? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startRuntime(intent)
            ACTION_STOP -> stopRuntime()
        }
        return START_NOT_STICKY
    }

    private fun startRuntime(intent: Intent) {
        val kernelId = intent.getStringExtra(EXTRA_KERNEL_ID)?.trim()
        AndroidKernelExecutionStateStore.beginStart(kernelId)

        runCatching {
            stopTun()
            require(!kernelId.isNullOrBlank()) { "selected kernel is missing" }

            val mode = intent.getStringExtra(AndroidVpnRuntimeProtocol.EXTRA_EXECUTION_MODE)
                ?.trim()
                ?.ifBlank { AndroidVpnRuntimeProtocol.MODE_PROXY }
                ?: AndroidVpnRuntimeProtocol.MODE_PROXY

            require(mode in setOf(
                AndroidVpnRuntimeProtocol.MODE_PROXY,
                AndroidVpnRuntimeProtocol.MODE_DIRECT,
                AndroidVpnRuntimeProtocol.MODE_REJECT,
                AndroidVpnRuntimeProtocol.MODE_CHAIN,
                AndroidVpnRuntimeProtocol.MODE_DNS,
            )) { "unsupported Android VPN execution mode: $mode" }

            val builder = Builder()
                .setSession(
                    intent.getStringExtra(AndroidVpnRuntimeProtocol.EXTRA_SESSION)
                        ?.trim()
                        ?.ifBlank { DEFAULT_SESSION }
                        ?: DEFAULT_SESSION
                )
                .setMtu(1500)
                .addAddress(
                    intent.getStringExtra(KEY_IPV4_ADDRESS)
                        ?.trim()
                        ?.ifBlank { DEFAULT_IPV4_ADDRESS }
                        ?: DEFAULT_IPV4_ADDRESS,
                    intent.getIntExtra(
                        AndroidVpnRuntimeProtocol.EXTRA_IPV4_PREFIX,
                        DEFAULT_IPV4_PREFIX,
                    ),
                )
                .setBlocking(false)

            intent.getStringArrayListExtra(AndroidVpnRuntimeProtocol.EXTRA_ROUTES)
                ?.forEach { route ->
                    val parts = route.split("/", limit = 2)
                    require(parts.size == 2) { "invalid route: $route" }
                    builder.addRoute(parts[0], parts[1].toInt())
                }

            intent.getStringExtra(AndroidVpnRuntimeProtocol.EXTRA_IPV6_ADDRESS)
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
                ?.let { address ->
                    builder.addAddress(
                        address,
                        intent.getIntExtra(AndroidVpnRuntimeProtocol.EXTRA_IPV6_PREFIX, 128),
                    )
                }

            intent.getStringArrayListExtra(AndroidVpnRuntimeProtocol.EXTRA_DNS_SERVERS)
                ?.forEach { dns -> builder.addDnsServer(dns) }

            if (Build.VERSION.SDK_INT >= 29) {
                builder.setMetered(false)
            }

            startForegroundRuntime()
            val established = builder.establish()
                ?: error("Android VpnService could not establish TUN")

            tun = established
            activeKernel = kernelId
            AndroidKernelExecutionStateStore.markRunning(kernelId)
        }.onFailure { failure ->
            stopTun()
            activeKernel = null
            AndroidKernelExecutionStateStore.markFailure(
                sanitizeFailure(failure.message ?: "VPN startup failed"),
                kernelId,
            )
            stopSelf()
        }
    }

    private fun startForegroundRuntime() {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "AngelaNexus VPN",
                    NotificationManager.IMPORTANCE_LOW,
                ),
            )
        }

        val notification = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("AngelaNexus")
            .setContentText("VPN data plane active")
            .setSmallIcon(android.R.drawable.stat_sys_warning)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun stopRuntime() {
        AndroidKernelExecutionStateStore.beginStop()
        stopTun()
        activeKernel = null
        AndroidKernelExecutionStateStore.markStopped()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun stopTun() {
        runCatching { tun?.close() }
        tun = null
    }

    override fun onDestroy() {
        stopTun()
        activeKernel = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?) = super.onBind(intent)

    private fun sanitizeFailure(detail: String): String =
        detail.replace(Regex("\s+"), " ").take(256)
}
