package app.angelanexus

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.IBinder

/**
 * Real Android traffic-ingress runtime for the selected kernel.
 *
 * The service owns the Android VpnService descriptor. Kernel selection and
 * normalized configuration are supplied by Core; this class never chooses a
 * kernel on its own.
 */
class AngelaNexusVpnService : VpnService() {
    private var tun: android.os.ParcelFileDescriptor? = null
    private var nativeHost: MihomoJniNativeHost? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action != ACTION_START) {
            if (intent?.action == ACTION_STOP) stopRuntime()
            return START_NOT_STICKY
        }

        val configJson = intent.getStringExtra(EXTRA_CONFIG_JSON)
        val address = intent.getStringExtra(EXTRA_ADDRESS) ?: DEFAULT_ADDRESS
        val dns = intent.getStringExtra(EXTRA_DNS) ?: DEFAULT_DNS
        val stack = intent.getStringExtra(EXTRA_STACK) ?: DEFAULT_STACK

        if (configJson.isNullOrBlank()) {
            stopSelfResult(startId)
            return START_NOT_STICKY
        }

        runCatching {
            startRuntime(configJson, address, dns, stack)
        }.onFailure {
            stopRuntime()
            stopSelfResult(startId)
        }

        return START_STICKY
    }

    private fun startRuntime(
        configJson: String,
        address: String,
        dns: String,
        stack: String,
    ) {
        if (tun != null) return

        val host = MihomoNativeRuntimeFactory.create(this)
        host.setVpnService(this)

        val builder = Builder()
            .setSession("AngelaNexus")
            .setMtu(DEFAULT_MTU)
            .addAddress(address, DEFAULT_PREFIX_LENGTH)
            .addDnsServer(dns)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            builder.setMetered(false)
        }

        val descriptor = builder.establish()
            ?: error("Android VpnService could not establish the TUN interface")

        try {
            val error = host.applyConfig(configJson)
            if (!error.isNullOrBlank()) {
                error("Mihomo rejected configuration: $error")
            }

            if (!host.startTun(descriptor.fd, stack, address, dns)) {
                error("Mihomo rejected the Android TUN descriptor")
            }

            tun = descriptor
            nativeHost = host
        } catch (error: Throwable) {
            descriptor.close()
            host.clearVpnService()
            throw error
        }
    }

    private fun stopRuntime() {
        val host = nativeHost
        runCatching { host?.stopTun() }
        runCatching { host?.clearVpnService() }
        nativeHost = null
        runCatching { tun?.close() }
        tun = null
        stopSelf()
    }

    override fun onDestroy() {
        stopRuntime()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = super.onBind(intent)

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "AngelaNexus VPN",
                NotificationManager.IMPORTANCE_LOW,
            ),
        )
    }

    private fun buildNotification(): Notification {
        val launchIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("AngelaNexus")
                .setContentText("Network proxy is running")
                .setSmallIcon(app.angelanexus.R.drawable.angelanexus_logo)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setContentTitle("AngelaNexus")
                .setContentText("Network proxy is running")
                .setSmallIcon(app.angelanexus.R.drawable.angelanexus_logo)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build()
        }
    }

    companion object {
        const val ACTION_START = "app.angelanexus.action.START"
        const val ACTION_STOP = "app.angelanexus.action.STOP"
        const val EXTRA_CONFIG_JSON = "app.angelanexus.extra.CONFIG_JSON"
        const val EXTRA_ADDRESS = "app.angelanexus.extra.ADDRESS"
        const val EXTRA_DNS = "app.angelanexus.extra.DNS"
        const val EXTRA_STACK = "app.angelanexus.extra.STACK"

        private const val CHANNEL_ID = "angelanexus-vpn"
        private const val NOTIFICATION_ID = 1001
        private const val DEFAULT_ADDRESS = "198.18.0.1"
        private const val DEFAULT_DNS = "198.18.0.2"
        private const val DEFAULT_STACK = "system"
        private const val DEFAULT_MTU = 9000
        private const val DEFAULT_PREFIX_LENGTH = 30
    }
}
