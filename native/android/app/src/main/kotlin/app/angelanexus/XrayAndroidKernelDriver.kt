package app.angelanexus

import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.os.ResultReceiver
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class XrayAndroidKernelDriver(
    private val context: Context,
) : AndroidKernelDriver {
    override val id: String = "xray"

    override val capabilities: Set<String> = setOf(
        AndroidKernelDriverCapabilities.CONFIG_APPLY,
        AndroidKernelDriverCapabilities.TUN_ATTACH,
        AndroidKernelDriverCapabilities.START_STOP,
        AndroidKernelDriverCapabilities.STATUS,
    )

    private var platformService: VpnService? = null
    private var configuration: String? = null
    private var tunFd: Int = -1
    private var attached = false
    private var running = false

    override fun preparePlatform(service: VpnService) {
        platformService = service
    }

    override fun initialize(homeDir: String) {
        check(platformService != null) { "Xray platform service is not prepared" }
    }

    override fun applyConfiguration(configuration: String) {
        check(configuration.isNotBlank()) { "Xray configuration is empty" }
        this.configuration = configuration
    }

    override fun attachTun(tunFd: Int, policy: AndroidVpnRuntimePolicy) {
        require(tunFd >= 0) { "tunFd must be non-negative" }
        check(platformService != null) { "Xray platform service is not prepared" }
        check(!attached) { "Xray TUN is already attached" }
        this.tunFd = tunFd
        attached = true
    }

    override fun start() {
        val service = platformService ?: error("Xray platform service is not prepared")
        val config = configuration ?: error("Xray configuration has not been applied")
        check(attached) { "Xray driver has no attached TUN" }
        check(!running) { "Xray driver is already running" }

        val protector = XrayVpnProtectorBinder(object : XrayVpnProtector {
            override fun protect(fd: Int): Boolean = service.protect(fd)
        })
        val pfd = ParcelFileDescriptor.adoptFd(tunFd)
        try {
            val result = send(
                Intent(context, XrayRuntimeService::class.java)
                    .setAction(XrayRuntimeProtocol.ACTION_START)
                    .putExtra(XrayRuntimeProtocol.EXTRA_CONFIG, config)
                    .putExtra(XrayRuntimeProtocol.EXTRA_DNS, "198.18.0.2:53")
                    .putExtra(XrayRuntimeProtocol.EXTRA_TUN, pfd)
                    .putExtra(
                        XrayRuntimeProtocol.EXTRA_PROTECTOR,
                        Bundle().apply { putBinder("binder", protector) },
                    ),
            )
            check(result.first) { result.second }
            running = true
        } catch (failure: Throwable) {
            attached = false
            running = false
            throw failure
        } finally {
            // The runtime receives its own ParcelFileDescriptor through IPC.
            // This local descriptor always belongs to the driver and must be
            // closed after hand-off, including timeout/failure paths.
            runCatching { pfd.close() }
            tunFd = -1
        }
    }

    override fun stop() {
        runCatching {
            send(
                Intent(context, XrayRuntimeService::class.java)
                    .setAction(XrayRuntimeProtocol.ACTION_STOP),
            )
        }
        runCatching {
            if (tunFd >= 0) {
                ParcelFileDescriptor.adoptFd(tunFd).close()
            }
        }
        tunFd = -1
        attached = false
        running = false
        platformService = null
        configuration = null
    }

    override fun status(): AndroidKernelDriverStatus =
        AndroidKernelDriverStatus(
            id,
            running,
            if (attached) "TUN attached" else "idle",
        )

    private fun send(intent: Intent): Pair<Boolean, String> {
        val latch = CountDownLatch(1)
        var success = false
        var error = "Xray runtime did not return a result"
        val receiver = object : ResultReceiver(null) {
            override fun onReceiveResult(resultCode: Int, resultData: Bundle?) {
                success = resultCode == XrayRuntimeProtocol.RESULT_OK
                error = resultData?.getString(XrayRuntimeProtocol.RESULT_ERROR) ?: error
                latch.countDown()
            }
        }
        intent.putExtra(XrayRuntimeProtocol.EXTRA_RESULT, receiver)
        context.startService(intent)
        check(latch.await(20, TimeUnit.SECONDS)) {
            "Timed out waiting for isolated Xray runtime"
        }
        return success to error
    }
}
