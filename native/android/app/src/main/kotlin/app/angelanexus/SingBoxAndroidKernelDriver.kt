package app.angelanexus

import android.net.ConnectivityManager
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
        platform.pendingTunFd = tun
        attached = true
    }

    override fun start() {
        check(attached) { "sing-box driver has no attached TUN" }
        check(!running) { "sing-box driver is already running" }
        val config = configuration ?: error("sing-box configuration is required")
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
        try {
            server.start()
            commandServer = server
            server.startOrReloadService(config, null)
            running = true
        } catch (error: Throwable) {
            runCatching { commandServer?.closeService() }
            runCatching { commandServer?.close() }
            if (commandServer == null) {
                runCatching { server.closeService() }
                runCatching { server.close() }
            }
            commandServer = null
            runCatching { tun?.close() }
            tun = null
            platform.pendingTunFd = null
            attached = false
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
        platform.pendingTunFd = null
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
            check(service != null) { "Android VpnService is unavailable" }
            val descriptor = pendingTunFd ?: error("Android TUN descriptor is unavailable")
            // libbox transfers ownership of the descriptor returned by OpenTun.
            // Keep the driver's original descriptor private and hand native code a duplicate.
            return ParcelFileDescriptor.fromFd(descriptor.fd).detachFd()
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

        private val interfaceMonitors =
            java.util.concurrent.ConcurrentHashMap<InterfaceUpdateListener, ConnectivityManager.NetworkCallback>()

        override fun startDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
                return
            }
            val connectivity = context.getSystemService(ConnectivityManager::class.java)
                ?: error("ConnectivityManager unavailable")
            val callback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: android.net.Network) {
                    updateDefaultInterface(connectivity, network, listener)
                }

                override fun onCapabilitiesChanged(
                    network: android.net.Network,
                    capabilities: android.net.NetworkCapabilities,
                ) {
                    updateDefaultInterface(connectivity, network, listener, capabilities)
                }

                override fun onLost(network: android.net.Network) {
                    listener.updateDefaultInterface("", -1, false, false)
                }
            }
            check(interfaceMonitors.putIfAbsent(listener, callback) == null) {
                "default interface monitor is already registered"
            }
            connectivity.registerDefaultNetworkCallback(callback)
        }

        override fun closeDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
            val connectivity = context.getSystemService(ConnectivityManager::class.java) ?: return
            interfaceMonitors.remove(listener)?.let { callback ->
                runCatching { connectivity.unregisterNetworkCallback(callback) }
            }
        }

        override fun getInterfaces(): NetworkInterfaceIterator {
            val interfaces = mutableListOf<io.nekohasekai.libbox.NetworkInterface>()
            val connectivity = context.getSystemService(ConnectivityManager::class.java)
            val networks = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP && connectivity != null) {
                connectivity.allNetworks.toList()
            } else {
                emptyList()
            }
            val linkProperties = networks.mapNotNull { network ->
                connectivity?.getLinkProperties(network)
            }.associateBy { it.interfaceName }

            val enumeration = java.net.NetworkInterface.getNetworkInterfaces()
                ?: return NetworkInterfaceListIterator(emptyList())
            while (enumeration.hasMoreElements()) {
                val networkInterface = enumeration.nextElement()
                val result = io.nekohasekai.libbox.NetworkInterface()
                result.index = networkInterface.index
                result.mtu = networkInterface.mtu
                result.name = networkInterface.name
                result.addresses = StringListIterator(
                    networkInterface.interfaceAddresses.map { address ->
                        address.address.hostAddress + "/" + address.networkPrefixLength
                    },
                )
                result.flags = networkInterfaceFlags(networkInterface)
                val properties = linkProperties[networkInterface.name]
                result.type = properties?.let { networkInterfaceType(connectivity, networks, it) }
                    ?: io.nekohasekai.libbox.Libbox.InterfaceTypeOther
                result.setDNSServer(StringListIterator(
                    properties?.dnsServers?.mapNotNull { it.hostAddress } ?: emptyList(),
                ))
                result.metered = properties?.let { props ->
                    connectivity?.getNetworkCapabilities(networks.firstOrNull { network ->
                        connectivity.getLinkProperties(network)?.interfaceName == props.interfaceName
                    })?.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == false
                } ?: false
                interfaces += result
            }
            return NetworkInterfaceListIterator(interfaces)
        }

        private fun updateDefaultInterface(
            connectivity: ConnectivityManager,
            network: android.net.Network,
            listener: InterfaceUpdateListener,
            capabilities: android.net.NetworkCapabilities? = connectivity.getNetworkCapabilities(network),
        ) {
            val properties = connectivity.getLinkProperties(network) ?: return
            val interfaceName = properties.interfaceName ?: return
            val index = runCatching {
                java.net.NetworkInterface.getByName(interfaceName).index
            }.getOrElse { -1 }
            val expensive = capabilities?.hasCapability(
                android.net.NetworkCapabilities.NET_CAPABILITY_NOT_METERED,
            ) == false
            listener.updateDefaultInterface(interfaceName, index, expensive, false)
        }

        private fun networkInterfaceType(
            connectivity: ConnectivityManager?,
            networks: List<android.net.Network>,
            properties: android.net.LinkProperties,
        ): Int {
            val network = networks.firstOrNull { candidate ->
                connectivity?.getLinkProperties(candidate)?.interfaceName == properties.interfaceName
            } ?: return io.nekohasekai.libbox.Libbox.InterfaceTypeOther
            val capabilities = connectivity?.getNetworkCapabilities(network)
                ?: return io.nekohasekai.libbox.Libbox.InterfaceTypeOther
            return when {
                capabilities.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) ->
                    io.nekohasekai.libbox.Libbox.InterfaceTypeWIFI
                capabilities.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR) ->
                    io.nekohasekai.libbox.Libbox.InterfaceTypeCellular
                capabilities.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET) ->
                    io.nekohasekai.libbox.Libbox.InterfaceTypeEthernet
                else -> io.nekohasekai.libbox.Libbox.InterfaceTypeOther
            }
        }

        private fun networkInterfaceFlags(networkInterface: java.net.NetworkInterface): Int {
            var flags = 0
            if (networkInterface.isUp) flags = flags or 0x1
            if (networkInterface.isLoopback) flags = flags or 0x8
            if (networkInterface.isPointToPoint) flags = flags or 0x10
            if (networkInterface.isVirtual) flags = flags or 0x10000
            return flags
        }

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

    private class NetworkInterfaceListIterator(
        private val values: List<io.nekohasekai.libbox.NetworkInterface>,
    ) : NetworkInterfaceIterator {
        private var index = 0

        override fun hasNext(): Boolean = index < values.size

        override fun next(): io.nekohasekai.libbox.NetworkInterface =
            values.getOrNull(index++) ?: error("no more network interfaces")
    }

    private class StringListIterator(
        private val values: List<String>,
    ) : StringIterator {
        private var index = 0

        override fun len(): Int = values.size

        override fun hasNext(): Boolean = index < values.size

        override fun next(): String =
            values.getOrNull(index++) ?: error("no more strings")
    }
}
