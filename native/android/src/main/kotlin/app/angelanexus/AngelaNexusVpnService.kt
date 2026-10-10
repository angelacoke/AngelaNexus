package app.angelanexus

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

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
        const val EXTRA_HANDOFF_TOKEN = "app.angelanexus.extra.HANDOFF_TOKEN"

        private const val CHANNEL_ID = "angelanexus-vpn"
        private const val NOTIFICATION_ID = 18181
        private const val CORE_HOME = "angelanexus/core"
    }

    private val policy = AndroidVpnRuntimePolicy.default()
    private val runtimeOperations = AndroidRuntimeOperationQueue()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val stopThroughStartId = AtomicInteger(0)
    @Volatile private var latestStartId = 0
    private var driver: AndroidKernelDriver? = null
    @Volatile private var tunEstablished = false
    @Volatile private var activeTrafficAcceptanceProbe: AndroidTrafficAcceptanceProbe? = null
    private var stopFailure: Throwable? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        latestStartId = startId
        return when (intent?.action) {
            ACTION_START -> {
                if (tunEstablished) return START_NOT_STICKY
                val handoffToken = intent.getStringExtra(EXTRA_HANDOFF_TOKEN)
                // Promote synchronously before returning from this foreground-service start;
                // all potentially blocking runtime work is serialized on the worker below.
                startForeground(NOTIFICATION_ID, notification("VPN runtime starting"))
                runtimeOperations.execute {
                    if (isStartCancelled(startId)) {
                        handoffToken?.let { AndroidRuntimeHandoffStore.discard(it) }
                        return@execute
                    }
                    val handoff = AndroidRuntimeHandoffStore.consume(handoffToken)
                    if (handoff == null) rejectMissingHandoff(startId)
                    else startRuntime(
                        handoff.kernel,
                        handoff.configuration,
                        handoff.executionIntentJson,
                        startId,
                    )
                }
                START_NOT_STICKY
            }
            ACTION_STOP -> {
                stopThroughStartId.updateAndGet { current -> maxOf(current, startId) }
                activeTrafficAcceptanceProbe?.cancel()
                runtimeOperations.execute { stopRuntime(startId = startId) }
                START_NOT_STICKY
            }
            else -> {
                stopThroughStartId.updateAndGet { current -> maxOf(current, startId) }
                activeTrafficAcceptanceProbe?.cancel()
                runtimeOperations.execute { stopRuntime(startId = startId) }
                START_NOT_STICKY
            }
        }
    }

    private fun rejectMissingHandoff(startId: Int): Int {
        val state = AndroidKernelExecutionStateStore.state.value
        if (!state.cleanupRequired && state.phase in setOf(
                KernelExecutionPhase.IDLE,
                KernelExecutionPhase.READY,
                KernelExecutionPhase.STOPPED,
            )
        ) {
            AndroidKernelExecutionStateStore.beginStart(state.kernelId)
        }
        AndroidKernelExecutionStateStore.markFailure(
            "Android runtime handoff expired or unavailable; import the configuration again",
            state.kernelId,
            cleanupRequired = state.cleanupRequired,
        )
        requestServiceStop(startId)
        return START_NOT_STICKY
    }

    private fun startRuntime(
        kernelId: String?,
        configuration: String?,
        executionIntentJson: String?,
        startId: Int,
    ): Int {
        if (tunEstablished || isStartCancelled(startId)) return START_NOT_STICKY
        stopFailure?.let {
            fail(
                "VPN runtime remains in failed-stop state: " + (it.message ?: it::class.java.simpleName),
                kernelId,
                cleanupRequired = true,
            )
            return START_NOT_STICKY
        }

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

            check(!isStartCancelled(startId)) { "VPN start cancelled by stop request" }
            val descriptor = builder.establish()
                ?: error("Android VPN TUN establishment failed")

            // startTUN duplicates and takes ownership of the native descriptor.
            // Detach here so ParcelFileDescriptor cannot later close a reused fd.
            val fd = descriptor.detachFd()
            var driverOwnsTun = false
            try {
                check(!isStartCancelled(startId)) { "VPN start cancelled by stop request" }
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
                check(!isStartCancelled(startId)) { "VPN start cancelled by stop request" }

                // Native health is only a runtime liveness signal. When Core
                // explicitly requires network acceptance, prove a real HTTPS
                // request through this VPN process before publishing Running.
                val acceptance = executionIntent.trafficAcceptance
                if (acceptance?.required == true) {
                    updateNotification("VPN runtime verifying network traffic")
                    check(!acceptance.expectedResponseHeader.isNullOrBlank() &&
                        !acceptance.expectedResponseValue.isNullOrBlank()) {
                        "required traffic acceptance has no trusted proxy-evidence response marker"
                    }
                    val probe = AndroidTrafficAcceptanceProbe()
                    activeTrafficAcceptanceProbe = probe
                    if (isStartCancelled(startId)) probe.cancel()
                    val acceptanceResult = try {
                        probe.probe(
                            targetUrl = acceptance.targetUrl,
                            timeoutMs = acceptance.timeoutMs,
                            expectedResponseHeader = acceptance.expectedResponseHeader,
                            expectedResponseValue = acceptance.expectedResponseValue,
                        )
                    } finally {
                        if (activeTrafficAcceptanceProbe === probe) {
                            activeTrafficAcceptanceProbe = null
                        }
                    }
                    if (acceptanceResult.result == AndroidTrafficAcceptanceProbe.RESULT_CANCELLED &&
                        isStartCancelled(startId)
                    ) {
                        error("VPN start cancelled by stop request")
                    }
                    check(acceptanceResult.result == AndroidTrafficAcceptanceProbe.RESULT_SUCCESS) {
                        "traffic acceptance failed for " + acceptanceResult.targetUrl + ": " +
                            (acceptanceResult.reason ?: "unexpected-http-status")
                    }
                }

                check(!isStartCancelled(startId)) { "VPN start cancelled by stop request" }
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
            val cleanupFailure = stopRuntime(keepService = true)
            if (isStartCancelled(startId)) {
                if (cleanupFailure != null) {
                    fail(
                        "VPN start was cancelled but runtime cleanup failed: " +
                            (cleanupFailure.message ?: cleanupFailure::class.java.simpleName),
                        kernelId,
                        cleanupRequired = true,
                    )
                    updateNotification("VPN runtime stop failed; retry cleanup from the app")
                }
            } else {
                val detail = if (cleanupFailure == null) {
                    error.message ?: "VPN runtime failed"
                } else {
                    (error.message ?: "VPN runtime failed") + "; cleanup also failed: " +
                        (cleanupFailure.message ?: cleanupFailure::class.java.simpleName)
                }
                fail(detail, kernelId, cleanupRequired = cleanupFailure != null)
                if (cleanupFailure == null) {
                    requestServiceStop(startId)
                } else {
                    updateNotification("VPN runtime stop failed; retry cleanup from the app")
                }
            }
            START_NOT_STICKY
        }
    }

    private fun stopRuntime(
        keepService: Boolean = false,
        startId: Int? = null,
    ): Throwable? {
        val phase = AndroidKernelExecutionStateStore.state.value.phase
        val hasRuntimeResources = driver != null || tunEstablished
        val stopRequestedForActivePhase = !keepService && phase in setOf(
            KernelExecutionPhase.STARTING,
            KernelExecutionPhase.RUNNING,
            KernelExecutionPhase.FAILED,
        )
        if ((hasRuntimeResources || stopRequestedForActivePhase) && phase != KernelExecutionPhase.STOPPING) {
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
                if (AndroidKernelExecutionStateStore.state.value.phase == KernelExecutionPhase.STOPPING) {
                    AndroidKernelExecutionStateStore.markStopped()
                }
                requestServiceStop(startId)
            } else {
                // A failed kernel stop means native runtime state is not
                // proven stopped. Keep the service alive and fail closed:
                // do not advertise STOPPED and do not accept a new START.
                updateNotification("VPN runtime stop failed")
                AndroidKernelExecutionStateStore.markFailure(
                    failure.message ?: "kernel stop failed",
                    null,
                    cleanupRequired = true,
                )
            }
        }
        return failure
    }

    private fun isStartCancelled(startId: Int): Boolean =
        startId <= stopThroughStartId.get()

    private fun requestServiceStop(startId: Int?) {
        mainHandler.post {
            val shouldStop = if (startId == null) {
                stopSelf()
                true
            } else {
                stopSelfResult(startId)
            }
            if (shouldStop) stopForegroundCompat()
        }
    }

    private fun fail(detail: String, kernelId: String?, cleanupRequired: Boolean = false) {
        AndroidKernelExecutionStateStore.markFailure(detail, kernelId, cleanupRequired)
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
        runtimeOperations.execute {
            val cleanupFailure = stopRuntime(keepService = true)
            if (cleanupFailure == null) {
                val phase = AndroidKernelExecutionStateStore.state.value.phase
                if (phase !in setOf(KernelExecutionPhase.IDLE, KernelExecutionPhase.STOPPED)) {
                    if (phase != KernelExecutionPhase.STOPPING) {
                        AndroidKernelExecutionStateStore.beginStop()
                    }
                    AndroidKernelExecutionStateStore.markStopped()
                }
            } else {
                AndroidKernelExecutionStateStore.markFailure(
                    cleanupFailure.message ?: "kernel stop failed during service destruction",
                    null,
                    cleanupRequired = true,
                )
            }
        }
        runtimeOperations.shutdown()
        super.onDestroy()
    }

    override fun onRevoke() {
        val revokeStartId = latestStartId
        stopThroughStartId.updateAndGet { current -> maxOf(current, revokeStartId) }
        activeTrafficAcceptanceProbe?.cancel()
        runtimeOperations.execute {
            stopRuntime(startId = revokeStartId.takeIf { it > 0 })
        }
        super.onRevoke()
    }

    override fun onBind(intent: Intent?): IBinder? = super.onBind(intent)
}
