package app.angelanexus

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.IBinder
import java.io.File

/**
 * Android system interception boundary.
 *
 * The service owns only Android VpnService lifecycle and TUN establishment.
 * Mihomo remains a kernel/driver: it receives the already-established TUN fd
 * and executes the platform intent. Configuration parsing and kernel selection
 * stay outside this service.
 */
class AngelaNexusVpnService : VpnService() {
    companion object {
        const val ACTION_START = "app.angelanexus.action.START_VPN"
        const val ACTION_STOP = "app.angelanexus.action.STOP_VPN"
        const val EXTRA_KERNEL_ID = "app.angelanexus.extra.KERNEL_ID"

        private const val CHANNEL_ID = "angelanexus.vpn"
        private const val NOTIFICATION_ID = 18181
        private const val CORE_HOME = "angelanexus/core"
    }

    private val policy = AndroidVpnRuntimePolicy.default()
    private var runtime: MihomoJniNativeHost? = null
    private var tunEstablished = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification("VPN runtime starting"))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> stopRuntime()
            ACTION_START, null -> startRuntime(intent?.getStringExtra(EXTRA_KERNEL_ID))
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent): IBinder? = super.onBind(intent)

    override fun onRevoke() {
        stopRuntime()
        super.onRevoke()
    }

    override fun onDestroy() {
        stopRuntime()
        super.onDestroy()
    }

    private fun startRuntime(kernelId: String?) {
        if (tunEstablished) return
        if (!kernelId.equals("mihomo", ignoreCase = true)) {
            fail("No Android driver is registered for kernel '$kernelId'", kernelId)
            return
        }

        AndroidKernelExecutionStateStore.beginStart(kernelId)

        runCatching {
            val nativeRuntime = runtime ?: MihomoNativeRuntimeFactory.create(this).also { runtime = it }
            nativeRuntime.initialize(File(filesDir, CORE_HOME).absolutePath)
            nativeRuntime.setVpnService(this)

            val builder = Builder()
                .setSession("AngelaNexus")
                .setMtu(policy.mtu)

            policy.addresses.forEach { address ->
                val separator = address.lastIndexOf('/')
                require(separator > 0) { "invalid VPN address: $address" }
                val ip = address.substring(0, separator)
                val prefix = address.substring(separator + 1).toInt()
                builder.addAddress(ip, prefix)
            }

            policy.routes.forEach { route ->
                val separator = route.lastIndexOf('/')
                require(separator > 0) { "invalid VPN route: $route" }
                val ip = route.substring(0, separator)
                val prefix = route.substring(separator + 1).toInt()
                builder.addRoute(ip, prefix)
            }

            val descriptor = builder.establish()
                ?: error("Android VpnService refused to establish the TUN interface")

            val fd = descriptor.detachFd()
            descriptor.close()

            val started = nativeRuntime.startTun(
                tunFd = fd,
                stack = policy.stack,
                address = policy.addresses.joinToString(","),
                dns = policy.dnsHijack,
            )
            check(started) { "Mihomo failed to attach the Android TUN interface" }

            tunEstablished = true
            AndroidKernelExecutionStateStore.markRunning(kernelId)
            updateNotification("VPN runtime active — $kernelId")
        }.onFailure { error ->
            stopRuntimeInternal()
            fail(error.message ?: "VPN runtime failed", kernelId)
        }
    }

    private fun stopRuntime() {
        if (!tunEstablished && runtime == null) {
            AndroidKernelExecutionStateStore.markStopped()
            stopSelf()
            return
        }
        AndroidKernelExecutionStateStore.beginStop()
        stopRuntimeInternal()
        AndroidKernelExecutionStateStore.markStopped()
        stopSelf()
    }

    private fun stopRuntimeInternal() {
        runCatching { runtime?.stopTun() }
        runCatching { runtime?.clearVpnService() }
        tunEstablished = false
    }

    private fun fail(detail: String, kernelId: String?) {
        AndroidKernelExecutionStateStore.markFailure(detail, kernelId)
        updateNotification("VPN runtime failed")
        stopSelf()
    }

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

    private fun buildNotification(text: String): Notification =
        Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.angelanexus_logo)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(
                PendingIntent.getActivity(
                    this,
                    0,
                    Intent(this, MainActivity::class.java),
                    PendingIntent.FLAG_UPDATE_CURRENT or
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0,
                ),
            )
            .build()

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(text))
    }
}
