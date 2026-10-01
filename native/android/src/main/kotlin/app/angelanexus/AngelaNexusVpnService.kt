package app.angelanexus

import android.content.Intent
import android.net.VpnService
import android.os.IBinder

/**
 * Native Android VPN boundary.
 *
 * The service owns only Android VPN lifecycle and TUN establishment. It accepts
 * an already-resolved runtime descriptor; it never parses imported configuration
 * or selects a kernel.
 */
class AngelaNexusVpnService : VpnService() {

    companion object {
        const val ACTION_START = "app.angelanexus.action.START"
        const val ACTION_STOP = "app.angelanexus.action.STOP"
        const val EXTRA_COMPILED_CONFIG_JSON = "app.angelanexus.extra.COMPILED_CONFIG_JSON"
        const val EXTRA_ADDRESS = "app.angelanexus.extra.ADDRESS"
        const val EXTRA_ROUTE = "app.angelanexus.extra.ROUTE"
        const val EXTRA_DNS = "app.angelanexus.extra.DNS"
    }

    private var tunInterface: android.os.ParcelFileDescriptor? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return when (intent?.action) {
            ACTION_START -> {
                val configJson = intent.getStringExtra(EXTRA_COMPILED_CONFIG_JSON)
                val address = intent.getStringExtra(EXTRA_ADDRESS)
                val route = intent.getStringExtra(EXTRA_ROUTE)
                val dns = intent.getStringExtra(EXTRA_DNS)

                if (configJson.isNullOrBlank() || address.isNullOrBlank() ||
                    route.isNullOrBlank() || dns.isNullOrBlank()
                ) {
                    stopSelfResult(startId)
                    START_NOT_STICKY
                } else {
                    establishTun(address, route, dns)
                    START_STICKY
                }
            }

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

    private fun establishTun(address: String, route: String, dns: String) {
        val builder = Builder()
            .setSession("AngelaNexus")
            .setBlocking(false)
            .addAddress(address.substringBefore('/'), address.substringAfter('/').toInt())
            .addRoute(route.substringBefore('/'), route.substringAfter('/').toInt())
            .addDnsServer(dns)

        tunInterface?.close()
        tunInterface = builder.establish()
        check(tunInterface != null) { "Android VPN TUN establishment failed" }
    }

    private fun stopRuntime() {
        tunInterface?.close()
        tunInterface = null
        stopSelf()
    }

    override fun onDestroy() {
        stopRuntime()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = super.onBind(intent)
}
