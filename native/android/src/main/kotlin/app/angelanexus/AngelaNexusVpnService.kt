package app.angelanexus

import android.content.Intent
import android.net.VpnService
import android.os.IBinder

/**
 * Native Android VPN boundary.
 *
 * This class owns only Android VPN service lifecycle and the TUN file descriptor.
 * Kernel startup/configuration is delegated to the platform-neutral application
 * layer; no kernel policy is selected here.
 */
class AngelaNexusVpnService : VpnService() {
    private var tunInterface: ParcelFileDescriptorHolder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val builder = Builder()
            .setSession("AngelaNexus")
            .setBlocking(false)

        // Address/routes/DNS are supplied by application policy at runtime.
        // No default route is installed here to avoid silently changing user policy.
        tunInterface?.close()
        tunInterface = ParcelFileDescriptorHolder(builder.establish())

        return START_STICKY
    }

    override fun onDestroy() {
        tunInterface?.close()
        tunInterface = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = super.onBind(intent)

    private class ParcelFileDescriptorHolder(
        private val descriptor: android.os.ParcelFileDescriptor?
    ) {
        fun close() {
            descriptor?.close()
        }
    }
}
