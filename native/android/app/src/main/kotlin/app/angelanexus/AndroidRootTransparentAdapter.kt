package app.angelanexus

import android.content.Context

/**
 * Capability probe and lifecycle boundary for the optional rooted transparent adapter.
 *
 * Root mode is selectable only when the device exposes the complete network
 * interception contract. Capability probing never installs or mutates network rules.
 */
class AndroidRootTransparentAdapter(private val context: Context) {
    data class Capabilities(
        val rootAvailable: Boolean,
        val rootAuthorized: Boolean,
        val systemVpnAvailable: Boolean,
        val tcp: Boolean,
        val udp: Boolean,
        val dns: Boolean,
        val ipv4: Boolean,
        val ipv6: Boolean,
        val uidIdentity: Boolean,
        val processIdentity: Boolean,
        val policyRouting: Boolean,
        val atomicRollback: Boolean,
    ) {
        val rootBackendReady: Boolean
            get() = rootAvailable &&
                rootAuthorized &&
                tcp &&
                udp &&
                dns &&
                ipv4 &&
                ipv6 &&
                uidIdentity &&
                processIdentity &&
                policyRouting &&
                atomicRollback
    }

    fun inspect(): Capabilities {
        val rootAvailable = RootShellProbe.isRootAvailable()
        val rootAuthorized = rootAvailable && RootShellProbe.commandSucceeds("id")
        val networkTools = rootAuthorized && RootShellProbe.networkToolsAvailable()

        // The current tree has not yet bound a verified rule-installation backend.
        // Therefore capability flags remain false until that backend is present.
        return Capabilities(
            rootAvailable = rootAvailable,
            rootAuthorized = rootAuthorized,
            systemVpnAvailable = true,
            tcp = networkTools && false,
            udp = networkTools && false,
            dns = networkTools && false,
            ipv4 = networkTools && false,
            ipv6 = networkTools && false,
            uidIdentity = false,
            processIdentity = false,
            policyRouting = networkTools && false,
            atomicRollback = false,
        )
    }

    fun begin(): Transaction {
        check(inspect().rootBackendReady) {
            "root transparent backend is not ready"
        }
        return Transaction()
    }

    inner class Transaction {
        private var prepared = false
        private var committed = false

        fun prepare() {
            check(!prepared && !committed) { "transaction is not reusable" }
            prepared = true
        }

        fun commit() {
            check(prepared && !committed) { "transaction is not prepared" }
            try {
                // Rule installation is intentionally delegated to the verified backend.
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

        fun commandSucceeds(command: String): Boolean = try {
            val process = Runtime.getRuntime().exec(arrayOf("su", "-c", command))
            process.inputStream.close()
            process.errorStream.close()
            process.waitFor() == 0
        } catch (_: Throwable) {
            false
        }

        fun networkToolsAvailable(): Boolean {
            val ip = commandSucceeds("command -v ip")
            val firewall = commandSucceeds("command -v nft") || commandSucceeds("command -v iptables")
            return ip && firewall
        }
    }
}
