package app.angelanexus

import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class KernelCapabilityRegistryTest {
    @Test
    fun profiles_mark_driver_available_only_when_status_is_verifiable() {
        val status = AndroidKernelDriverStatus("mihomo", running = false, detail = "stopped")
        val profile = KernelCapabilityRegistry.profiles(
            listOf(FakeDriver(status = status)),
        ).single()

        assertTrue(profile.available)
        assertEquals(status, profile.status)
    }

    @Test
    fun profiles_mark_driver_unavailable_when_status_check_fails() {
        val profile = KernelCapabilityRegistry.profiles(
            listOf(FakeDriver(status = null, failStatus = true)),
        ).single()

        assertFalse(profile.available)
        assertEquals(null, profile.status)
    }

    @Test
    fun profiles_mark_driver_unavailable_without_capabilities() {
        val profile = KernelCapabilityRegistry.profiles(
            listOf(FakeDriver(status = AndroidKernelDriverStatus("empty", false), capabilities = emptySet())),
        ).single()

        assertFalse(profile.available)
    }

    private class FakeDriver(
        private val status: AndroidKernelDriverStatus?,
        private val failStatus: Boolean = false,
        override val capabilities: Set<String> = setOf(AndroidKernelDriverCapabilities.STATUS),
    ) : AndroidKernelDriver {
        override val id: String = status?.driverId ?: "unavailable"

        override fun preparePlatform(service: android.net.VpnService) = Unit
        override fun initialize(homeDir: String) = Unit
        override fun applyConfiguration(configuration: String) = Unit
        override fun attachTun(tunFd: Int, policy: AndroidVpnRuntimePolicy) = Unit
        override fun start() = Unit
        override fun stop() = Unit

        override fun status(): AndroidKernelDriverStatus {
            if (failStatus) error("runtime status unavailable")
            return requireNotNull(status)
        }
    }
}
