package app.angelanexus

import android.content.Context

/**
 * Root transparent adapter.
 *
 * The platform-neutral transparent contract remains the source of truth.
 * This adapter only binds a verified Android/Linux interception backend to it.
 */
class AndroidRootTransparentAdapter(
    private val context: Context,
    private val backend: Backend = AndroidRootBackend(context),
) {
    data class Capabilities(
        val rootAvailable: Boolean,
        val rootAuthorized: Boolean,
        val systemVpnAvailable: Boolean,
        val tcp: Boolean,
        val udp: Boolean,
        val dns: Boolean,
        val icmp: Boolean,
        val ipv4: Boolean,
        val ipv6: Boolean,
        val uidIdentity: Boolean,
        val processIdentity: Boolean,
        val policyRouting: Boolean,
        val atomicRollback: Boolean,
    ) {
        val rootBackendReady: Boolean
            get() = rootAvailable && rootAuthorized && tcp && udp && dns && icmp &&
                ipv4 && ipv6 && uidIdentity && processIdentity &&
                policyRouting && atomicRollback
    }

    interface Backend {
        fun inspect(): Capabilities
        fun createTransaction(config: RootTransparentConfig): RootTransparentRuleTransaction
    }

    fun inspect(): Capabilities = backend.inspect()

    fun begin(config: RootTransparentConfig): RootTransparentRuleTransaction {
        check(inspect().rootBackendReady) { "root transparent backend is not ready" }
        return backend.createTransaction(config)
    }
}

private class AndroidRootBackend(
    private val context: Context,
    private val capabilityProbe: AndroidRootCapabilityProbe =
        AndroidRootVerifiedCapabilityProbe(SuRootProbeRunner()),
) : AndroidRootTransparentAdapter.Backend {
    override fun inspect(): AndroidRootTransparentAdapter.Capabilities {
        val rootAvailable = RootShellProbe.isRootAvailable()
        val rootAuthorized = rootAvailable && RootShellProbe.commandSucceeds("id")

        val ipv4PolicyRouting = rootAuthorized && capabilityProbe.ipv4PolicyRouting()
        val ipv6PolicyRouting = rootAuthorized && capabilityProbe.ipv6PolicyRouting()

        return AndroidRootTransparentAdapter.Capabilities(
            rootAvailable = rootAvailable,
            rootAuthorized = rootAuthorized,
            systemVpnAvailable = true,
            tcp = rootAuthorized && capabilityProbe.tcpTproxy(),
            udp = rootAuthorized && capabilityProbe.udpTproxy(),
            dns = rootAuthorized && capabilityProbe.dnsInterception(),
            icmp = rootAuthorized && capabilityProbe.icmpCapture(),
            ipv4 = ipv4PolicyRouting,
            ipv6 = ipv6PolicyRouting,
            uidIdentity = rootAuthorized && capabilityProbe.uidIdentity(),
            processIdentity = rootAuthorized && capabilityProbe.processIdentity(),
            policyRouting = ipv4PolicyRouting && ipv6PolicyRouting,
            atomicRollback = rootAuthorized && capabilityProbe.atomicRollback(),
        )
    }

    override fun createTransaction(config: RootTransparentConfig): RootTransparentRuleTransaction {
        check(inspect().rootBackendReady) { "verified root transparent capabilities are required" }
        return RootTransparentRuleTransaction(
            SuRootCommandExecutor(),
            AndroidRootTransparentRules.build(config),
        )
    }

    private class SuRootCommandExecutor : RootCommandExecutor {
        override fun execute(command: String) {
            require(command.isNotBlank())
            val process = Runtime.getRuntime().exec(arrayOf("su", "-c", command))
            val exit = process.waitFor()
            if (exit != 0) throw IllegalStateException("root command failed with exit code $exit")
        }
    }

    private class SuRootProbeRunner : AndroidRootProbeRunner {
        override fun run(command: String): RootProbeResult {
            require(command.isNotBlank())
            return try {
                val process = Runtime.getRuntime().exec(arrayOf("su", "-c", command))
                val stdout = process.inputStream.bufferedReader().use { it.readText() }
                val stderr = process.errorStream.bufferedReader().use { it.readText() }
                val exit = process.waitFor()
                RootProbeResult(exit, stdout, stderr)
            } catch (error: Throwable) {
                RootProbeResult(-1, "", error.message.orEmpty())
            }
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
    }
}
