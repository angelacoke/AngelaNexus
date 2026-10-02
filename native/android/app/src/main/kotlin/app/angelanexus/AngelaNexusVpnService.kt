package app.angelanexus

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.net.VpnService
import android.os.Build

/**
 * System VPN execution boundary.
 *
 * The service accepts only an already-normalized Mihomo JSON configuration.
 * It does not parse or select kernels. Socket protection is installed before
 * the TUN runtime is activated so the core cannot silently loop its own
 * outbound sockets back through the VPN.
 */
class AngelaNexusVpnService : VpnService() {
    private var tunFd: android.os.ParcelFileDescriptor? = null
    private var mihomo: MihomoJniNativeHost? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return runCatching {
            startForeground(NOTIFICATION_ID, notification())
            stopRuntime()

            val configJson = intent?.getStringExtra(EXTRA_CONFIG_JSON)
                ?.takeIf { it.isNotBlank() }
                ?: error("normalized Mihomo configuration is required")

            val stack = intent.getStringExtra(EXTRA_STACK) ?: DEFAULT_STACK
            val address = intent.getStringExtra(EXTRA_ADDRESS) ?: DEFAULT_ADDRESS
            val dns = intent.getStringExtra(EXTRA_DNS) ?: DEFAULT_DNS

            val host = MihomoNativeRuntimeFactory.create(this)
            mihomo = host
            host.setVpnService(this)
            check(host.hasVpnProtector()) { "Android VpnService protector is unavailable" }

            val applyError = host.applyConfig(configJson)
            check(applyError.isNullOrBlank()) {
                applyError ?: "Mihomo rejected the configuration"
            }

            val descriptor = Builder()
                .setSession(getString(R.string.app_name))
                .setMtu(DEFAULT_MTU)
                .addAddress("198.18.0.1", 30)
                .addRoute("0.0.0.0", 0)
                .addDnsServer("198.18.0.2")
                .addAddress("fd00:198:18::1", 126)
                .addRoute("::", 0)
                .establish()
                ?: error("Android refused to establish the VPN interface")

            tunFd = descriptor
            check(host.startTun(descriptor.fd, stack, address, dns)) {
                "Mihomo failed to bind the Android TUN descriptor"
            }

            START_NOT_STICKY
        }.getOrElse {
            stopRuntime()
            stopSelfResult(startId)
            START_NOT_STICKY
        }
    }

    override fun onDestroy() {
        stopRuntime()
        super.onDestroy()
    }

    override fun onRevoke() {
        stopRuntime()
        stopSelf()
        super.onRevoke()
    }

    private fun stopRuntime() {
        runCatching { mihomo?.stopTun() }
        runCatching { mihomo?.clearVpnService() }
        mihomo = null
        runCatching { tunFd?.close() }
        tunFd = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
    }

    private fun notification(): Notification {
        val channelId = "angelanexus-vpn"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel(
                    channelId,
                    getString(R.string.app_name),
                    NotificationManager.IMPORTANCE_LOW,
                ),
            )
        }
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, channelId)
                .setSmallIcon(R.drawable.angelanexus_logo)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(getString(R.string.status_vpn_boundary_started))
                .setOngoing(true)
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setSmallIcon(R.drawable.angelanexus_logo)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(getString(R.string.status_vpn_boundary_started))
                .setOngoing(true)
                .build()
        }
    }

    companion object {
        const val ACTION_START = "app.angelanexus.action.START_VPN"
        const val EXTRA_CONFIG_JSON = "angelanexus.extra.CONFIG_JSON"
        const val EXTRA_STACK = "angelanexus.extra.STACK"
        const val EXTRA_ADDRESS = "angelanexus.extra.ADDRESS"
        const val EXTRA_DNS = "angelanexus.extra.DNS"

        private const val NOTIFICATION_ID = 18181
        private const val DEFAULT_MTU = 1400
        private const val DEFAULT_STACK = "mixed"
        private const val DEFAULT_ADDRESS = "198.18.0.2/30,fd00:198:18::2/126"
        private const val DEFAULT_DNS = "198.18.0.2"
    }
}
