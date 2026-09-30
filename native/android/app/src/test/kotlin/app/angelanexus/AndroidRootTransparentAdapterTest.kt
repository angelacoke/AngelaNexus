package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AndroidRootTransparentAdapterTest {
    private class VerifiedProbe : AndroidRootCapabilityProbe {
        override fun tcpTproxy() = true
        override fun udpTproxy() = true
        override fun dnsInterception() = true
        override fun ipv4PolicyRouting() = true
        override fun ipv6PolicyRouting() = true
        override fun uidIdentity() = true
        override fun processIdentity() = true
        override fun atomicRollback() = true
    }

    @Test
    fun unverified_probe_never_reports_capabilities() {
        val probe = UnverifiedAndroidRootCapabilityProbe
        assertFalse(probe.tcpTproxy())
        assertFalse(probe.udpTproxy())
        assertFalse(probe.dnsInterception())
        assertFalse(probe.ipv4PolicyRouting())
        assertFalse(probe.ipv6PolicyRouting())
        assertFalse(probe.uidIdentity())
        assertFalse(probe.processIdentity())
        assertFalse(probe.atomicRollback())
    }

    @Test
    fun verified_probe_can_supply_positive_evidence() {
        val probe = VerifiedProbe()
        assertTrue(probe.tcpTproxy())
        assertTrue(probe.udpTproxy())
        assertTrue(probe.dnsInterception())
        assertTrue(probe.ipv4PolicyRouting())
        assertTrue(probe.ipv6PolicyRouting())
        assertTrue(probe.uidIdentity())
        assertTrue(probe.processIdentity())
        assertTrue(probe.atomicRollback())
    }
}
