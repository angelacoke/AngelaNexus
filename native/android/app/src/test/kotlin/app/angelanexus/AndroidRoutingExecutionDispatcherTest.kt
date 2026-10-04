package app.angelanexus

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AndroidRoutingExecutionDispatcherTest {
    private fun intent(mode: String, action: String, target: String? = null): AndroidRoutingExecutionIntent {
        val targetJson = target?.let { ""target":"" + it + ""," } ?: ""
        val hopsJson = if (mode == "chain") ""hops":["first","second"]" else ""
        val comma = if (targetJson.isNotEmpty() && hopsJson.isNotEmpty()) "," else ""
        return AndroidRoutingExecutionIntent.parse(
            "{"version":1,"kind":"routing-execution-intent","mode":"$mode","action":"$action",$targetJson$hopsJson}"
        )
    }

    @Test
    fun proxyUsesOnlyCoreSelectedKernel() {
        val driver = object : AndroidKernelDriver {
            override val id = "xray"
            override val capabilities = emptySet<String>()
            override fun preparePlatform(service: android.net.VpnService) = Unit
            override fun initialize(homeDir: String) = Unit
            override fun applyConfiguration(configuration: String) = Unit
            override fun attachTun(tunFd: Int, policy: AndroidVpnRuntimePolicy) = Unit
            override fun start() = Unit
            override fun stop() = Unit
            override fun status() = AndroidKernelDriverStatus(id, false)
        }
        val result = AndroidRoutingExecutionDispatcher { kernelId ->
            assertEquals("xray", kernelId)
            driver
        }.dispatch(intent("proxy", "route", "node-1"), "xray")

        assertEquals("xray", result.kernelId)
        assertEquals("xray", result.driver?.id)
        assertEquals("node-1", result.target)
    }

    @Test(expected = IllegalArgumentException::class)
    fun proxyWithoutCoreKernelFailsClosed() {
        AndroidRoutingExecutionDispatcher { error("must not resolve a driver") }
            .dispatch(intent("proxy", "route", "node-1"), null)
    }

    @Test
    fun directDoesNotResolveOrFallbackToKernel() {
        val result = AndroidRoutingExecutionDispatcher {
            error("direct mode must not resolve a kernel")
        }.dispatch(intent("direct", "bypass", "direct"), "mihomo")

        assertEquals("direct", result.mode)
        assertNull(result.kernelId)
        assertNull(result.driver)
    }

    @Test
    fun chainPreservesOrderedHopPayloadWithoutKernelFallback() {
        val result = AndroidRoutingExecutionDispatcher {
            error("chain intent must not silently select a kernel")
        }.dispatch(intent("chain", "chain"), "mihomo")

        assertEquals("chain", result.mode)
        assertNull(result.kernelId)
        assertEquals("["first","second"]", result.hopsJson)
    }
}
