package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AndroidVpnRuntimeProtocolTest {
    @Test
    fun executionModesRemainExplicitAndKernelNeutral() {
        assertEquals("proxy", AndroidVpnRuntimeProtocol.MODE_PROXY)
        assertEquals("direct", AndroidVpnRuntimeProtocol.MODE_DIRECT)
        assertEquals("reject", AndroidVpnRuntimeProtocol.MODE_REJECT)
        assertEquals("chain", AndroidVpnRuntimeProtocol.MODE_CHAIN)
        assertEquals("dns", AndroidVpnRuntimeProtocol.MODE_DNS)
        assertTrue(AndroidVpnRuntimeProtocol.EXTRA_KERNEL_ID.contains("KERNEL_ID"))
    }
}
