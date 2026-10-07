package app.angelanexus

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class KernelDriverSchedulerTest {
    private class FakeDriver(
        override val id: String,
        override val capabilities: Set<String>,
        private val statusResult: AndroidKernelDriverStatus = AndroidKernelDriverStatus(id, false),
        private val statusFailure: Boolean = false,
    ) : AndroidKernelDriver {
        override fun preparePlatform(service: android.net.VpnService) = Unit
        override fun initialize(homeDir: String) = Unit
        override fun applyConfiguration(configuration: String) = Unit
        override fun attachTun(tunFd: Int, policy: AndroidVpnRuntimePolicy) = Unit
        override fun start() = Unit
        override fun stop() = Unit

        override fun status(): AndroidKernelDriverStatus {
            if (statusFailure) {
                error("status unavailable")
            }
            return statusResult
        }
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
        val selection = scheduler.select(KernelExecutionIntent(preferredKernelId = "xray"))
        assertEquals("xray", selection.kernelId)
        assertEquals(KernelDriverSelectionReason.PREFERRED_MATCH, selection.reason)
        assertEquals(listOf("mihomo", "xray"), selection.candidates)
    }

    @Test
    fun preferredKernelIdMatchingIsCaseAndWhitespaceInsensitive() {
        val scheduler = KernelDriverScheduler(
            listOf(FakeDriver("mihomo", full), FakeDriver("Xray", full)),
        )
        assertEquals(
            "Xray",
            scheduler.select(KernelExecutionIntent(preferredKernelId = "  xRaY ")).kernelId,
        )
    }

    @Test
    fun blankPreferredKernelIdBehavesLikeNoPreference() {
        val scheduler = KernelDriverScheduler(
            listOf(FakeDriver("sing-box", full), FakeDriver("mihomo", full)),
        )
        val selection = scheduler.select(KernelExecutionIntent(preferredKernelId = "   "))
        assertEquals("sing-box", selection.kernelId)
        assertEquals(KernelDriverSelectionReason.FIRST_CAPABILITY_MATCH, selection.reason)
        assertEquals(listOf("sing-box", "mihomo"), selection.candidates)
    }

    @Test
    fun schedulerExplainsPreferredFallbackWhenPreferenceIsUnavailable() {
        val scheduler = KernelDriverScheduler(
            listOf(FakeDriver("sing-box", full), FakeDriver("mihomo", full)),
        )
        val selection = scheduler.select(KernelExecutionIntent(preferredKernelId = "xray"))
        assertEquals("sing-box", selection.kernelId)
        assertEquals(KernelDriverSelectionReason.PREFERRED_UNAVAILABLE_FALLBACK, selection.reason)
        assertEquals(listOf("sing-box", "mihomo"), selection.candidates)
    }

    @Test
    fun schedulerFallsBackToFirstCapabilityMatchWhenNoPreferenceExists() {
        val scheduler = KernelDriverScheduler(
            listOf(FakeDriver("sing-box", full), FakeDriver("mihomo", full)),
        )
        val selection = scheduler.select(KernelExecutionIntent())
        assertEquals("sing-box", selection.kernelId)
        assertEquals(KernelDriverSelectionReason.FIRST_CAPABILITY_MATCH, selection.reason)
        assertEquals(listOf("sing-box", "mihomo"), selection.candidates)
    }

    @Test
    fun schedulerSkipsDriverWhoseRuntimeStatusCannotBeRead() {
        val scheduler = KernelDriverScheduler(
            listOf(
                FakeDriver("mihomo", full, statusFailure = true),
                FakeDriver("xray", full),
            ),
        )
        val selection = scheduler.select(KernelExecutionIntent(preferredKernelId = "mihomo"))
        assertEquals("xray", selection.kernelId)
        assertEquals(KernelDriverSelectionReason.PREFERRED_UNAVAILABLE_FALLBACK, selection.reason)
        assertEquals(listOf("xray"), selection.candidates)
    }

    @Test
    fun schedulerFailsWhenNoAvailableDriverSatisfiesCapabilities() {
        val scheduler = KernelDriverScheduler(
            listOf(FakeDriver("mihomo", full, statusFailure = true)),
        )
        assertThrows(IllegalStateException::class.java) {
            scheduler.select(KernelExecutionIntent())
        }
    }
}
