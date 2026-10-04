package app.angelanexus

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidKernelDriverRegistryTest {
    @Test
    fun registryIdentitySetContainsAllThreeParallelKernels() {
        val identities = listOf("mihomo", "sing-box", "xray")
        assertEquals(setOf("mihomo", "sing-box", "xray"), identities.toSet())
    }

    @Test
    fun mihomoDriverExposesCommonExecutionContract() {
        val driver = MihomoAndroidKernelDriver(FakeMihomoNativeHost())
        assertEquals("mihomo", driver.id)
        assertTrue(driver.capabilities.contains(AndroidKernelDriverCapabilities.CONFIG_APPLY))
        assertTrue(driver.capabilities.contains(AndroidKernelDriverCapabilities.TUN_ATTACH))
        assertTrue(driver.capabilities.contains(AndroidKernelDriverCapabilities.START_STOP))
        assertTrue(driver.capabilities.contains(AndroidKernelDriverCapabilities.STATUS))
    }

    private class FakeMihomoNativeHost : MihomoNativeHost {
        override fun initialize(homeDir: String) = Unit
        override fun setVpnService(service: android.net.VpnService) = Unit
        override fun clearVpnService() = Unit
        override fun hasVpnProtector(): Boolean = true
        override fun applyConfig(configJson: String): String? = null
        override fun startTun(tunFd: Int, stack: String, address: String, dns: String): Boolean = true
        override fun stopTun() = Unit
        override fun updateDns(dns: String) = Unit
        override fun setSuspended(suspended: Boolean) = Unit
        override fun invokeMethod(data: String, callback: (String?) -> Unit) = callback(null)
        override fun setEventListener(callback: ((String?) -> Unit)?) = Unit
        override fun forceGc() = Unit
        override fun getTraffic(onlyStatisticsProxy: Boolean): String = "{}"
        override fun getTotalTraffic(onlyStatisticsProxy: Boolean): String = "{}"
    }
}
