package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AndroidRootVerifiedCapabilityProbeTest {
    private class Runner(
        private val result: RootProbeResult,
    ) : AndroidRootProbeRunner {
        val commands = mutableListOf<String>()
        override fun run(command: String): RootProbeResult {
            commands += command
            return result
        }
    }

    private class ProcessEvidence(
        private val available: Boolean,
    ) : AndroidRootProcessIdentityEvidence {
        override fun isAvailable() = available
    }

    @Test
    fun verified_probe_requires_positive_command_evidence() {
        val runner = Runner(RootProbeResult(1))
        val probe = AndroidRootVerifiedCapabilityProbe(runner)

        assertFalse(probe.tcpTproxy())
        assertFalse(probe.udpTproxy())
        assertFalse(probe.dnsInterception())
        assertFalse(probe.ipv4PolicyRouting())
        assertFalse(probe.ipv6PolicyRouting())
        assertFalse(probe.uidIdentity())
        assertFalse(probe.atomicRollback())
    }

    @Test
    fun successful_runtime_checks_provide_positive_evidence() {
        val runner = Runner(RootProbeResult(0))
        val probe = AndroidRootVerifiedCapabilityProbe(
            runner,
            ProcessEvidence(available = true),
        )

        assertTrue(probe.tcpTproxy())
        assertTrue(probe.udpTproxy())
        assertTrue(probe.dnsInterception())
        assertTrue(probe.ipv4PolicyRouting())
        assertTrue(probe.ipv6PolicyRouting())
        assertTrue(probe.uidIdentity())
        assertTrue(probe.processIdentity())
        assertTrue(probe.atomicRollback())
        assertTrue(runner.commands.all { it.isNotBlank() })
    }

    @Test
    fun process_identity_is_not_inferred_from_uid_or_nft_support() {
        val runner = Runner(RootProbeResult(0))
        val probe = AndroidRootVerifiedCapabilityProbe(
            runner,
            ProcessEvidence(available = false),
        )

        assertTrue(probe.uidIdentity())
        assertFalse(probe.processIdentity())
    }
}
