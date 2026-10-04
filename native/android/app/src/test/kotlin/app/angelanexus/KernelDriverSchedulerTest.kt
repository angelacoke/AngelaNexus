package app.angelanexus

import org.junit.Assert.assertEquals
import org.junit.Test

class KernelDriverSchedulerTest {
    private class FakeDriver(
        override val id: String,
        override val capabilities: Set<String>,
    ) : AndroidKernelDriver {
        override fun preparePlatform(service: android.net.VpnService) = Unit
        override fun initialize(homeDir: String) = Unit
        override fun applyConfiguration(configuration: String) = Unit
        override fun attachTun(tunFd: Int, policy: AndroidVpnRuntimePolicy) = Unit
        override fun start() = Unit
        override fun stop() = Unit
        override fun status() = AndroidKernelDriverStatus(id, false)
    }

    private val full = setOf(
        AndroidKernelDriverCapabilities.CONFIG_APPLY,
        AndroidKernelDriverCapabilities.TUN_ATTACH,
        AndroidKernelDriverCapabilities.START_STOP,
        AndroidKernelDriverCapabilities.STATUS,
    )

    @Test
    fun preferredKernelWinsWhenCapabilitiesMatch() {
        val scheduler = KernelDriverScheduler(
            listOf(FakeDriver("mihomo", full), FakeDriver("xray", full)),
        )
        assertEquals(
            "xray",
            scheduler.select(KernelExecutionIntent(preferredKernelId = "xray")).kernelId,
        )
    }

    @Test
    fun schedulerFallsBackToFirstCapabilityMatchWhenNoPreferenceExists() {
        val scheduler = KernelDriverScheduler(
            listOf(FakeDriver("sing-box", full), FakeDriver("mihomo", full)),
        )
        assertEquals("sing-box", scheduler.select(KernelExecutionIntent()).kernelId)
    }
}