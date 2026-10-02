package app.angelanexus

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.IBinder

/**
 * Native Android VPN execution boundary.
 *
 * The service receives an already-resolved Mihomo JSON configuration. It does
 * not parse user imports or choose a kernel. The native host is required to
 * install VpnService.protect before TUN execution is accepted.
 */
class AngelaNexusVpnService : VpnService() {

    companion object {
        const val ACTION_START = "app.angelanexus.action.START"
        const val ACTION_STOP = "app.angelanexus.action.STOP"
        const val EXTRA_COMPILED_CONFIG_JSON = "app.angelanexus.extra.COMPILED_CONFIG_JSON"
        const val EXTRA_ADDRESS = "app.angelanexus.extra.ADDRESS"
        const val EXTRA_ROUTE = "app.angelanexus.extra.ROUTE"
        const val EXTRA_DNS = "app.angelanexus.extra.DNS"
        const val EXTRA_STACK = "app.angelanexus.extra.STACK"

        private const val CHANNEL_ID = "angelanexus-vpn"
        private const val NOTIFICATION_ID = 18181
        private const val DEFAULT_ADDRESS = "198.18.0.2/30"
        private const val DEFAULT_ROUTE = "0.0.0.0/0"
        private const val DEFAULT_DNS = "198.18.0.2"
        private const val DEFAULT_STACK = "mixed"
    }

    private var tunInterface: android.os.ParcelFileDescriptor? = null
    private var mihomo: MihomoJniNativeHost? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return when (intent?.action) {
            ACTION_START -> startRuntime(intent, startId)
            ACTION_STOP -> {
                stopRuntime()
                START_NOT_STICKY
            }
            else -> {
                stopSelfResult(startId)
                START_NOT_STICKY
            }
        }
    }

    private fun startRuntime(intent: Intent, startId: Int): Int {
        return runCatching {
            startForeground(NOTIFICATION_ID, notification())

            stopRuntime(keepService = true)

            val configJson = intent.getStringExtra(EXTRA_COMPILED_CONFIG_JSON)
                ?.takeIf { it.isNotBlank() }
                ?: error("compiled Mihomo configuration is required")

            val address = intent.getStringExtra(EXTRA_ADDRESS) ?: DEFAULT_ADDRESS
            val route = intent.getStringExtra(EXTRA_ROUTE) ?: DEFAULT_ROUTE
            val dns = intent.getStringExtra(EXTRA_DNS) ?: DEFAULT_DNS
            val stack = intent.getStringExtra(EXTRA_STACK) ?: DEFAULT_STACK

            val host = MihomoNativeRuntimeFactory.create(this)
            mihomo = host
            host.setVpnService(this)
            check(host.hasVpnProtector()) { "Android VpnService protector is unavailable" }

            val applyError = host.applyConfig(configJson)
            check(applyError.isNullOrBlank()) {
                applyError ?: "Mihomo rejected the compiled configuration"
            }

            val builder = Builder()
                .setSession(getString(R.string.app_name))
                .setMtu(1400)
                .setBlocking(false)
                .addAddress(address.substringBefore('/'), address.substringAfter('/').toInt())
                .addRoute(route.substringBefore('/'), route.substringAfter('/').toInt())
                .addDnsServer(dns)

            val descriptor = builder.establish()
                ?: error("Android VPN TUN establishment failed")

            tunInterface = descriptor
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

    private fun stopRuntime(keepService: Boolean = false) {
        runCatching { mihomo?.stopTun() }
        runCatching { mihomo?.clearVpnService() }
        mihomo = null

        runCatching { tunInterface?.close() }
        tunInterface = null

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }

        if (!keepService) {
            stopSelf()
        }
    }

    private fun notification(): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    getString(R.string.app_name),
                    NotificationManager.IMPORTANCE_LOW,
                ),
            )
            return Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.sym_def_app_icon)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(getString(R.string.status_vpn_boundary_started))
                .setOngoing(true)
                .build()
        }

        @Suppress("DEPRECATION")
        return Notification.Builder(this)
            .setSmallIcon(android.R.drawable.sym_def_app_icon)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.status_vpn_boundary_started))
            .setOngoing(true)
            .build()
    }

    override fun onDestroy() {
        stopRuntime()
        super.onDestroy()
    }

    override fun onRevoke() {
        stopRuntime()
        super.onRevoke()
    }

    override fun onBind(intent: Intent?): IBinder? = super.onBind(intent)
}
