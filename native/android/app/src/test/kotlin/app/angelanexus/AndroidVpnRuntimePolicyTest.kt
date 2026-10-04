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
        assertContains(policy.addresses, "172.19.0.1/30")
        assertContains(policy.addresses, "fd00:4e58:0:1::1/126")
        assertContains(policy.routes, "0.0.0.0/0")
        assertContains(policy.routes, "::/0")
        assertTrue(policy.mtu >= 1280)
    }

    @Test
    fun dnsHijackIsNotInventedByPlatformLayer() {
        assertEquals("", AndroidVpnRuntimePolicy.default().dnsHijack)
    }
}
