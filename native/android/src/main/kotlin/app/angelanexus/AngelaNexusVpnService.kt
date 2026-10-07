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
        const val EXTRA_EXECUTION_INTENT_JSON = "app.angelanexus.extra.EXECUTION_INTENT_JSON"

        private const val CHANNEL_ID = "angelanexus-vpn"
        private const val NOTIFICATION_ID = 18181
        private const val CORE_HOME = "angelanexus/core"
    }

    private val policy = AndroidVpnRuntimePolicy.default()
    private var driver: AndroidKernelDriver? = null
    private var tunEstablished = false
    private var stopFailure: Throwable? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return when (intent?.action) {
            ACTION_START -> startRuntime(
                intent.getStringExtra(EXTRA_KERNEL_ID),
                intent.getStringExtra(EXTRA_CONFIGURATION),
                intent.getStringExtra(EXTRA_EXECUTION_INTENT_JSON),
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

    private fun startRuntime(
        kernelId: String?,
        configuration: String?,
        executionIntentJson: String?,
        startId: Int,
    ): Int {
        if (tunEstablished) return START_NOT_STICKY
        stopFailure?.let {
            fail("VPN runtime remains in failed-stop state: " + (it.message ?: it::class.java.simpleName), kernelId)
            return START_NOT_STICKY
        }

        startForeground(NOTIFICATION_ID, notification("VPN runtime starting"))
        AndroidKernelExecutionStateStore.beginStart(kernelId)

        return runCatching {
            stopRuntime(keepService = true)

            val executionIntent = executionIntentJson?.let(AndroidRoutingExecutionIntent::parse)
                ?: error("canonical routing execution intent is required for Android VPN startup")

            val dispatch = AndroidRoutingExecutionDispatcher { selectedKernelId ->
                AndroidKernelDriverRegistry.resolve(this, selectedKernelId)
            }.dispatch(executionIntent, kernelId)

            // Only a proxy intent currently has a kernel-backed Android TUN
            // executor. Other canonical modes remain fail-closed until their
            // platform data-plane implementation is available. They must never
            // be silently reinterpreted as proxy.
            val selectedDriver = dispatch.driver
                ?: error(
                    "Android system VPN data plane cannot execute routing mode '${dispatch.mode}' yet; refusing implicit reinterpretation",
                )

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
            var driverOwnsTun = false
            try {
                selectedDriver.attachTun(fd, policy)
                driverOwnsTun = true
                selectedDriver.start()

                // A successful start call is not sufficient evidence that the
                // native driver is actually running. Verify the driver-reported
                // state before publishing VPN/TUN as active.
                val runtimeStatus = selectedDriver.status()
                check(runtimeStatus.driverId == selectedDriver.id) {
                    "kernel driver status identity mismatch: expected '" + selectedDriver.id +
                        "', got '" + runtimeStatus.driverId + "'"
                }
                check(runtimeStatus.running) {
                    "kernel driver reported a non-running state after start: " +
                        (runtimeStatus.detail ?: "no detail")
                }

                tunEstablished = true
            } finally {
                if (!driverOwnsTun) {
                    runCatching { android.os.ParcelFileDescriptor.adoptFd(fd).close() }
                }
            }
            AndroidKernelExecutionStateStore.markRunning(selectedDriver.id)
            updateNotification("VPN runtime active — ${selectedDriver.id}")
            START_NOT_STICKY
        }.getOrElse { error ->
            val cleanupFailure = stopRuntime()
            val detail = if (cleanupFailure == null) {
                error.message ?: "VPN runtime failed"
            } else {
                (error.message ?: "VPN runtime failed") + "; cleanup also failed: " +
                    (cleanupFailure.message ?: cleanupFailure::class.java.simpleName)
            }
            fail(detail, kernelId)
            stopSelfResult(startId)
            START_NOT_STICKY
        }
    }

    private fun stopRuntime(keepService: Boolean = false): Throwable? {
        if (driver != null || tunEstablished) {
            AndroidKernelExecutionStateStore.beginStop()
        }

        var failure: Throwable? = null
        try {
            driver?.stop()
        } catch (error: Throwable) {
            failure = error
        }

        if (failure == null) {
            driver = null
            tunEstablished = false
        } else {
            // Keep the driver instance available for a subsequent STOP retry.
            // Native stop has not been proven successful, so the service must
            // remain in a blocked/unknown state rather than discarding the
            // only handle capable of completing recovery.
            tunEstablished = true
        }
        stopFailure = failure

        if (!keepService) {
            if (failure == null) {
                stopForegroundCompat()
                AndroidKernelExecutionStateStore.markStopped()
                stopSelf()
            } else {
                // A failed kernel stop means native runtime state is not
                // proven stopped. Keep the service alive and fail closed:
                // do not advertise STOPPED and do not accept a new START.
                updateNotification("VPN runtime stop failed")
                AndroidKernelExecutionStateStore.markFailure(
                    failure.message ?: "kernel stop failed",
                    null,
                )
            }
        }
        return failure
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
