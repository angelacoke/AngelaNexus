package app.angelanexus

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class AndroidKernelDriverRegistryTest {
    @Test
    fun normalBuildDoesNotAssumeMihomoDistributionApproval() {
        assertFalse(BuildConfig.MIHOMO_DISTRIBUTION_APPROVED)
    }

    @Test
    fun mihomoIsStartableOnlyWhenItsNativeArtifactIsVerified() {
        val withoutMihomo = AndroidKernelDriverRegistry.proxyExecutionKernelIds(false)
        val withMihomo = AndroidKernelDriverRegistry.proxyExecutionKernelIds(true)

        assertEquals(setOf("sing-box", "xray"), withoutMihomo)
        assertEquals(setOf("mihomo", "sing-box", "xray"), withMihomo)
        assertFalse(AndroidKernelDriverRegistry.supportsProxyExecution("mihomo", withoutMihomo))
        assertTrue(AndroidKernelDriverRegistry.supportsProxyExecution("mihomo", withMihomo))
        assertTrue(AndroidKernelDriverRegistry.supportsProxyExecution("sing-box", withoutMihomo))
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

    @Test
    fun mihomoDriverRejectsDuplicateTunAttachment() {
        val driver = MihomoAndroidKernelDriver(FakeMihomoNativeHost())
        driver.initialize("/tmp/angelanexus-test")
        driver.attachTun(100, AndroidVpnRuntimePolicy.default())

        try {
            driver.attachTun(101, AndroidVpnRuntimePolicy.default())
            fail("duplicate TUN attachment must be rejected")
        } catch (error: IllegalStateException) {
            assertEquals("Mihomo TUN is already attached", error.message)
        }

        assertTrue(driver.status().detail == "TUN attached")
        driver.stop()
        assertFalse(driver.status().running)
        assertEquals("idle", driver.status().detail)
    }

    @Test
    fun mihomoStatusRequiresNativeRuntimeHealthAfterStart() {
        val driver = MihomoAndroidKernelDriver(FakeMihomoNativeHost(trafficSnapshot = "not-json"))
        driver.initialize("/tmp/angelanexus-test")
        driver.attachTun(100, AndroidVpnRuntimePolicy.default())
        driver.start()

        val error = assertThrows(IllegalStateException::class.java) { driver.status() }
        assertEquals("Mihomo native runtime health check returned invalid traffic state", error.message)
    }

    @Test
    fun mihomoFailedStopPreservesAttachedStateForRecovery() {
        val driver = MihomoAndroidKernelDriver(FakeMihomoNativeHost(stopTunFailure = true))
        driver.initialize("/tmp/angelanexus-test")
        driver.attachTun(100, AndroidVpnRuntimePolicy.default())
        driver.start()

        try {
            driver.stop()
            fail("failed native stop must throw")
        } catch (error: IllegalStateException) {
            assertEquals("native stop failed", error.message)
        }

        assertTrue(driver.status().running)
        assertEquals("TUN attached", driver.status().detail)
    }

    @Test
    fun mihomoFailedNativeTunAttachDoesNotEnterAttachedState() {
        val driver = MihomoAndroidKernelDriver(FakeMihomoNativeHost(startTunResult = false))
        driver.initialize("/tmp/angelanexus-test")
        try {
            driver.attachTun(100, AndroidVpnRuntimePolicy.default())
            fail("failed native TUN attach must throw")
        } catch (error: IllegalStateException) {
            assertEquals("Mihomo failed to bind the Android TUN descriptor", error.message)
        }

        assertFalse(driver.status().running)
        assertEquals("idle", driver.status().detail)
    }

    private class FakeMihomoNativeHost(
        private val startTunResult: Boolean = true,
        private val stopTunFailure: Boolean = false,
        private val trafficSnapshot: String = "{}",
    ) : MihomoNativeHost {
        override fun initialize(homeDir: String) = Unit
        override fun setVpnService(service: android.net.VpnService) = Unit
        override fun clearVpnService() = Unit
        override fun hasVpnProtector(): Boolean = true
        override fun applyConfig(configJson: String): String? = null
        override fun startTun(tunFd: Int, stack: String, address: String, dns: String): Boolean = startTunResult
        override fun stopTun() {
            if (stopTunFailure) throw IllegalStateException("native stop failed")
        }
        override fun updateDns(dns: String) = Unit
        override fun setSuspended(suspended: Boolean) = Unit
        override fun invokeMethod(data: String, callback: (String?) -> Unit) = callback(null)
        override fun setEventListener(callback: ((String?) -> Unit)?) = Unit
        override fun forceGc() = Unit
        override fun getTraffic(onlyStatisticsProxy: Boolean): String = trafficSnapshot
        override fun getTotalTraffic(onlyStatisticsProxy: Boolean): String = "{}"
    }
}
