package app.angelanexus

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.IBinder
import java.io.File

/**
 * Android system interception boundary.
 *
 * The platform owns VpnService/TUN lifecycle and policy. The service consumes
 * the kernel identity already resolved by Core; it never parses user config or
 * selects a kernel. The native driver receives the established TUN descriptor.
 */
class AngelaNexusVpnService : VpnService() {

    companion object {
        const val ACTION_START = "app.angelanexus.action.START"
        const val ACTION_STOP = "app.angelanexus.action.STOP"
        const val EXTRA_KERNEL_ID = "app.angelanexus.extra.KERNEL_ID"
        const val EXTRA_CONFIGURATION = "app.angelanexus.extra.CONFIGURATION"

        private const val CHANNEL_ID = "angelanexus-vpn"
        private const val NOTIFICATION_ID = 18181
        private const val CORE_HOME = "angelanexus/core"
    }

    private val policy = AndroidVpnRuntimePolicy.default()
    private var driver: AndroidKernelDriver? = null
    private var tunEstablished = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return when (intent?.action) {
            ACTION_START -> startRuntime(
                intent.getStringExtra(EXTRA_KERNEL_ID),
                intent.getStringExtra(EXTRA_CONFIGURATION),
                startId,
            )
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

    private fun startRuntime(kernelId: String?, configuration: String?, startId: Int): Int {
        if (tunEstablished) return START_NOT_STICKY

        startForeground(NOTIFICATION_ID, notification("VPN runtime starting"))
        AndroidKernelExecutionStateStore.beginStart(kernelId)

        return runCatching {
            stopRuntime(keepService = true)

            val registeredDrivers = AndroidKernelDriverRegistry.all(this)
            val selection = KernelDriverScheduler(registeredDrivers).select(
                KernelExecutionIntent(preferredKernelId = kernelId),
            )
            val selectedDriver = registeredDrivers.first { it.id == selection.kernelId }
            driver = selectedDriver
            selectedDriver.preparePlatform(this)
            selectedDriver.initialize(File(filesDir, CORE_HOME).absolutePath)
            configuration?.let { selectedDriver.applyConfiguration(it) }

            val builder = Builder()
                .setSession(getString(R.string.app_name))
                .setMtu(policy.mtu)
                .setBlocking(false)

            policy.addresses.forEach { cidr ->
                builder.addAddress(cidr.substringBefore('/'), cidr.substringAfter('/').toInt())
            }
            policy.routes.forEach { cidr ->
                builder.addRoute(cidr.substringBefore('/'), cidr.substringAfter('/').toInt())
            }
            policy.dnsHijack.split(',').map(String::trim).filter(String::isNotEmpty).forEach {
                builder.addDnsServer(it)
            }

            val descriptor = builder.establish()
                ?: error("Android VPN TUN establishment failed")

            // startTUN duplicates and takes ownership of the native descriptor.
            // Detach here so ParcelFileDescriptor cannot later close a reused fd.
            val fd = descriptor.detachFd()

            selectedDriver.attachTun(fd, policy)
            selectedDriver.start()

            tunEstablished = true
            AndroidKernelExecutionStateStore.markRunning(selectedDriver.id)
            updateNotification("VPN runtime active — $kernelId")
            START_NOT_STICKY
        }.getOrElse { error ->
            stopRuntime()
            fail(error.message ?: "VPN runtime failed", kernelId)
            stopSelfResult(startId)
            START_NOT_STICKY
        }
    }

    private fun stopRuntime(keepService: Boolean = false) {
        if (driver != null || tunEstablished) {
            AndroidKernelExecutionStateStore.beginStop()
        }
        runCatching { driver?.stop() }
        driver = null
        tunEstablished = false

        if (!keepService) {
            stopForegroundCompat()
            AndroidKernelExecutionStateStore.markStopped()
            stopSelf()
        }
    }

    private fun fail(detail: String, kernelId: String?) {
        AndroidKernelExecutionStateStore.markFailure(detail, kernelId)
        updateNotification("VPN runtime failed")
    }

    private fun stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                getString(R.string.app_name),
                NotificationManager.IMPORTANCE_LOW,
            ),
        )
    }

    private fun notification(text: String): Notification =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.sym_def_app_icon)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(text)
                .setOngoing(true)
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setSmallIcon(android.R.drawable.sym_def_app_icon)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(text)
                .setOngoing(true)
                .build()
        }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, notification(text))
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
