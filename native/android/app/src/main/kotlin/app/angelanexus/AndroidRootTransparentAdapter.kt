package app.angelanexus

import android.content.Context

/** Capability probe and lifecycle boundary for the optional rooted transparent adapter. */
class AndroidRootTransparentAdapter(private val context: Context) {
    data class Capabilities(
        val rootAvailable: Boolean,
        val rootAuthorized: Boolean,
        val systemVpnAvailable: Boolean,
    )

    fun inspect(): Capabilities {
        val rootAvailable = RootShellProbe.isRootAvailable()
        return Capabilities(
            rootAvailable = rootAvailable,
            rootAuthorized = rootAvailable,
            systemVpnAvailable = true,
        )
    }

    fun begin(): Transaction {
        val capabilities = inspect()
        check(capabilities.rootAvailable && capabilities.rootAuthorized) {
            "root transparent mode is unavailable"
        }
        return Transaction()
    }

    inner class Transaction {
        private var prepared = false
        private var committed = false

        fun prepare() {
            check(!prepared && !committed) { "transaction is not reusable" }
            // The interception backend is deliberately isolated from capability detection.
            // Concrete network-rule installation is supplied by the platform adapter layer.
            prepared = true
        }

        fun commit() {
            check(prepared && !committed) { "transaction is not prepared" }
            try {
                // No network rule is installed here until a verified Android backend is bound.
                committed = true
            } catch (error: Throwable) {
                rollback()
                throw error
            }
        }

        fun rollback() {
            if (!prepared || committed) return
            prepared = false
        }
    }

    private object RootShellProbe {
        fun isRootAvailable(): Boolean = try {
            val process = Runtime.getRuntime().exec(arrayOf("su", "-c", "id"))
            val output = process.inputStream.bufferedReader().use { it.readText() }
            val exit = process.waitFor()
            exit == 0 && output.contains("uid=0")
        } catch (_: Throwable) {
            false
        }
    }
}
