package app.angelanexus

import android.content.Context

/**
 * Root transparent adapter.
 *
 * The platform-neutral transparent contract remains the source of truth.
 * This adapter only binds verified Android/Linux interception capabilities.
 */
class AndroidRootTransparentAdapter(
    private val context: Context?,
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
        val localOutputCapture: Boolean,
        val processIdentity: Boolean,
        val policyRouting: Boolean,
        val atomicRollback: Boolean,
    ) {
        /**
         * Core interception readiness.
         *
         * ICMP and process identity are exposed as independent capabilities:
         * neither is falsely promoted to "supported" merely to unlock the
         * otherwise verified TCP/UDP/DNS transparent backend.
         */
        val rootBackendReady: Boolean
            get() = rootAvailable && rootAuthorized &&
                tcp && udp && dns &&
                ipv4 && ipv6 &&
                uidIdentity &&
                localOutputCapture &&
                policyRouting && atomicRollback

        val identityReady: Boolean
            get() = uidIdentity && processIdentity
    }

    interface Backend {
        fun inspect(): Capabilities
        fun createTransaction(config: RootTransparentConfig): RootTransparentRuleTransaction
        fun createRuntime(): AndroidRootTransparentRuntime
    }

    fun inspect(): Capabilities = backend.inspect()

    fun begin(config: RootTransparentConfig): RootTransparentRuleTransaction {
        check(inspect().rootBackendReady) { "root transparent backend is not ready" }
        return backend.createTransaction(config)
    }

    /**
     * Activates the verified Root transparent runtime.
     *
     * ACTIVE is reached only after the live kernel state has been inspected.
     * Verification failure is handled by the transaction rollback path.
     */
    fun activate(config: RootTransparentConfig): AndroidRootTransparentRuntime {
        check(inspect().rootBackendReady) { "root transparent backend is not ready" }
        return activate(config, backend.createTransaction(config))
    }

    /**
     * Activates a transaction prepared by [begin].
     *
     * Keeping the prepared transaction across the bridge lifecycle ensures the
     * exact transaction that passed the preparation boundary is the one that
     * reaches commit/verified activation.
     */
    fun activate(
        config: RootTransparentConfig,
        transaction: RootTransparentRuleTransaction,
    ): AndroidRootTransparentRuntime {
        check(inspect().rootBackendReady) { "root transparent backend is not ready" }
        val runtime = backend.createRuntime()
        runtime.activate(config, transaction)
        return runtime
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
            localOutputCapture = rootAuthorized && capabilityProbe.localOutputCapture(),
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

    override fun createRuntime(): AndroidRootTransparentRuntime =
        AndroidRootTransparentRuntime(
            AndroidRootTransparentStateInspector(SuRootProbeRunner()),
        )

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
