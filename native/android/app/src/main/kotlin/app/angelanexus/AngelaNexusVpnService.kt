package app.angelanexus

import android.app.Service
import android.content.Intent
import android.os.IBinder

/**
 * Android VPN lifecycle boundary.
 *
 * The service never interprets configuration and never selects a kernel. A future
 * compiled runtime descriptor is the only accepted input for activating a native
 * VPN runtime. Starting the service without such a descriptor is deliberately
 * rejected instead of creating a TUN that has no execution backend.
 */
class AngelaNexusVpnService : Service() {

    companion object {
        const val ACTION_START = "app.angelanexus.action.START"
        const val ACTION_STOP = "app.angelanexus.action.STOP"
        const val EXTRA_COMPILED_CONFIG_JSON = "app.angelanexus.extra.COMPILED_CONFIG_JSON"
    }

    private var active = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return when (intent?.action) {
            ACTION_STOP -> {
                stopRuntime()
                START_NOT_STICKY
            }
            ACTION_START -> {
                val configJson = intent.getStringExtra(EXTRA_COMPILED_CONFIG_JSON)
                if (configJson.isNullOrBlank()) {
                    stopSelfResult(startId)
                    START_NOT_STICKY
                } else {
                    startRuntime(configJson)
                    START_STICKY
                }
            }
            else -> START_NOT_STICKY
        }
    }

    private fun startRuntime(configJson: String) {
        require(configJson.isNotBlank()) { "compiled runtime configuration must not be blank" }
        /*
         * TUN establishment and native runtime startup are intentionally kept behind
         * the compiled-runtime contract. This lifecycle boundary must not claim that
         * a raw imported configuration is executable.
         */
        active = true
    }

    private fun stopRuntime() {
        if (!active) {
            stopSelf()
            return
        }
        active = false
        stopSelf()
    }

    override fun onDestroy() {
        stopRuntime()
        super.onDestroy()
    }
}
