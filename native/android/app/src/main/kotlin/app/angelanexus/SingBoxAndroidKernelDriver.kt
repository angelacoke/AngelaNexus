package app.angelanexus

import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.Process
import android.util.Log
import io.nekohasekai.libbox.BridgeOptions
import io.nekohasekai.libbox.BridgeSession
import io.nekohasekai.libbox.CommandServer
import io.nekohasekai.libbox.CommandServerHandler
import io.nekohasekai.libbox.ConnectionOwner
import io.nekohasekai.libbox.InterfaceUpdateListener
import io.nekohasekai.libbox.Libbox
import io.nekohasekai.libbox.LocalDNSTransport
import io.nekohasekai.libbox.NeighborEntryIterator
import io.nekohasekai.libbox.NeighborUpdateListener
import io.nekohasekai.libbox.NetworkInterfaceIterator
import io.nekohasekai.libbox.PlatformInterface
import io.nekohasekai.libbox.PlatformUser
import io.nekohasekai.libbox.ShellSession
import io.nekohasekai.libbox.StringIterator
import io.nekohasekai.libbox.TunOptions
import io.nekohasekai.libbox.WIFIState
import io.nekohasekai.libbox.SetupOptions
import io.nekohasekai.libbox.SystemProxyStatus
import java.io.File
import java.net.InetSocketAddress
import java.net.NetworkInterface

/**
 * sing-box execution driver.
 *
 * Android/VpnService remains the interception owner. libbox receives the
 * already-established descriptor through PlatformInterface.openTun(); the
 * ParcelFileDescriptor stays owned by this driver until libbox has started or
 * startup fails. No routing policy is delegated to sing-box.
 */
class SingBoxAndroidKernelDriver(
    private val context: android.content.Context,
) : AndroidKernelDriver {

    override val id: String = "sing-box"

    override val capabilities: Set<String> = setOf(
        AndroidKernelDriverCapabilities.CONFIG_APPLY,
        AndroidKernelDriverCapabilities.TUN_ATTACH,
        AndroidKernelDriverCapabilities.START_STOP,
        AndroidKernelDriverCapabilities.STATUS,
    )

    private val platform = Platform(context)
    private var commandServer: CommandServer? = null
    private var tun: ParcelFileDescriptor? = null
    private var initialized = false
    private var attached = false
    private var running = false
    private var configuration: String? = null

    override fun preparePlatform(service: VpnService) {
        platform.service = service
    }

    override fun initialize(homeDir: String) {
        File(homeDir).mkdirs()
        val base = context.filesDir
        val working = context.getExternalFilesDir(null) ?: context.filesDir
        val temp = context.cacheDir
        Libbox.setup(SetupOptions().apply {
            basePath = base.path
            workingPath = working.path
            tempPath = temp.path
            debug = false
            logMaxLines = 3000
            appVersion = "1"
            appMarketingVersion = "0.1.0"
        })
        initialized = true
    }

    override fun applyConfiguration(configuration: String) {
        check(initialized) { "sing-box driver is not initialized" }
        check(configuration.isNotBlank()) { "sing-box configuration is empty" }
        Libbox.checkConfig(configuration)
        this.configuration = configuration
    }

    override fun attachTun(tunFd: Int, policy: AndroidVpnRuntimePolicy) {
        check(initialized) { "sing-box driver is not initialized" }
        require(tunFd >= 0) { "tunFd must be non-negative" }
        check(tun == null) { "sing-box TUN is already attached" }
        tun = ParcelFileDescriptor.adoptFd(tunFd)
        attached = true
    }

    override fun start() {
        check(attached) { "sing-box driver has no attached TUN" }
        check(!running) { "sing-box driver is already running" }
        val config = configuration ?: error("sing-box configuration is required")
        try {
            val server = CommandServer(object : CommandServerHandler {
                override fun serviceStop() = Unit
                override fun serviceReload() = Unit
                override fun getSystemProxyStatus(): SystemProxyStatus? = SystemProxyStatus()
                override fun setSystemProxyEnabled(enabled: Boolean) = Unit
                override fun triggerNativeCrash() = Unit
                override fun writeDebugMessage(message: String?) {
                    Log.d("AngelaNexus-sing-box", message ?: "")
                }
                override fun connectSSHAgent(): Int = -1
            }, platform)
            server.start()
            commandServer = server
            server.startOrReloadService(config, null)
            running = true
        } catch (error: Throwable) {
            runCatching { commandServer?.close() }
            commandServer = null
            running = false
            throw error
        }
    }

    override fun stop() {
        runCatching { commandServer?.closeService() }
        runCatching { commandServer?.close() }
        commandServer = null
        runCatching { tun?.close() }
        tun = null
        attached = false
        running = false
        platform.service = null
        configuration = null
    }

    override fun status(): AndroidKernelDriverStatus =
        AndroidKernelDriverStatus(id, running, if (attached) "TUN attached" else "idle")

    private class Platform(private val context: android.content.Context) : PlatformInterface {
        @Volatile
        var service: VpnService? = null

        override fun usePlatformAutoDetectInterfaceControl(): Boolean = true

        override fun autoDetectInterfaceControl(fd: Int) {
            check(service?.protect(fd) == true) { "Android VpnService.protect failed" }
        }

        override fun openTun(options: TunOptions): Int {
            val descriptor = (this@Platform.service
                ?: error("Android VpnService is unavailable"))
            return pendingTunFd?.fd ?: error("Android TUN descriptor is unavailable")
        }

        @Volatile
        var pendingTunFd: ParcelFileDescriptor? = null

        override fun useProcFS(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q

        override fun findConnectionOwner(
            ipProtocol: Int,
            sourceAddress: String,
            sourcePort: Int,
            destinationAddress: String,
            destinationPort: Int,
        ): ConnectionOwner {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                error("Android connection owner lookup requires API 29")
            }
            val connectivity = context.getSystemService(ConnectivityManager::class.java)
                ?: error("ConnectivityManager unavailable")
            val uid = connectivity.getConnectionOwnerUid(
                ipProtocol,
                InetSocketAddress(sourceAddress, sourcePort),
                InetSocketAddress(destinationAddress, destinationPort),
            )
            if (uid == Process.INVALID_UID) error("Android connection owner not found")
            val owner = ConnectionOwner()
            owner.userId = uid
            owner.userName = context.packageManager.getPackagesForUid(uid)?.firstOrNull() ?: ""
            return owner
        }

        override fun startDefaultInterfaceMonitor(listener: InterfaceUpdateListener) = Unit
        override fun closeDefaultInterfaceMonitor(listener: InterfaceUpdateListener) = Unit

        override fun getInterfaces(): NetworkInterfaceIterator =
            EmptyNetworkInterfaceIterator()

        override fun underNetworkExtension(): Boolean = false
        override fun includeAllNetworks(): Boolean = false
        override fun readWIFIState(): WIFIState? = null
        override fun clearDNSCache() = Unit
        override fun sendNotification(notification: io.nekohasekai.libbox.Notification) = Unit
        override fun startNeighborMonitor(listener: NeighborUpdateListener) = Unit
        override fun closeNeighborMonitor(listener: NeighborUpdateListener) = Unit
        override fun registerMyInterface(name: String) = Unit

        override fun localDNSTransport(): LocalDNSTransport? = null

        override fun usePlatformShell(): Boolean = false
        override fun checkPlatformShell() {
            error("Android shell execution is not enabled by the platform driver")
        }

        override fun openShellSession(
            user: PlatformUser?,
            command: String?,
            environ: StringIterator?,
            term: String?,
            rows: Int,
            cols: Int,
        ): ShellSession {
            error("Android shell execution is not enabled by the platform driver")
        }

        override fun lookupUser(username: String?): PlatformUser {
            error("Android user lookup is not enabled by the platform driver")
        }

        override fun lookupSFTPServer(): String = error("SFTP is not enabled by the platform driver")
        override fun readSystemSSHHostKey(): String = error("SSH host key is not enabled by the platform driver")
        override fun tailscaleHostname(): String = Build.MODEL
        override fun usePlatformBridge(): Boolean = false
        override fun createBridge(options: BridgeOptions?): BridgeSession =
            error("Android bridge is not enabled by the platform driver")
    }

    private class EmptyNetworkInterfaceIterator : NetworkInterfaceIterator {
        override fun hasNext(): Boolean = false
        override fun next(): io.nekohasekai.libbox.NetworkInterface =
            error("no network interface")
    }
}
