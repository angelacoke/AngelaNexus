package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AndroidVpnRuntimePolicyTest {
    @Test
    fun defaultPolicyCreatesDualStackFullTunnelBoundary() {
        val policy = AndroidVpnRuntimePolicy.default()

        assertEquals("system", policy.stack)
        assertContains(policy.addresses, "198.18.0.2/30")
        assertContains(policy.addresses, "fd00:198:18::2/126")
        assertContains(policy.routes, "0.0.0.0/0")
        assertContains(policy.routes, "::/0")
        assertTrue(policy.mtu >= 1280)
        assertTrue(policy.allowedApplications.isEmpty())
    }

    @Test
    fun dnsHijackIsNotInventedByPlatformLayer() {
        assertEquals("198.18.0.2", AndroidVpnRuntimePolicy.default().dnsHijack)
    }
}
