package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AndroidTransparentRuntimeBridgeTest {
    @Test
    fun unavailableRootCapabilityFailsClosed() {
        val bridge = AndroidTransparentRuntimeBridge(adapterWithCapabilities(ready = false))

        val capability = bridge.inspectRootCapability()
        val prepared = bridge.prepare(testConfig())

        assertFalse(capability.supported)
        assertEquals("root-capability-unavailable", capability.reason)
        assertFalse(prepared.ok)
        assertEquals("idle", prepared.state)
    }

    @Test
    fun verifiedRootCapabilityCompletesNativeLifecycle() {
        val executor = RecordingExecutor()
        val inspector = MutableTransparentInspector()
        val adapter = AndroidRootTransparentAdapter(
            context = error("context not used in injected backend"),
            backend = object : AndroidRootTransparentAdapter.Backend {
                override fun inspect() = readyCapabilities()
                override fun createTransaction(config: RootTransparentConfig) =
                    RootTransparentRuleTransaction(
                        executor,
                        AndroidRootTransparentRules.build(config),
                    )
                override fun createRuntime() =
                    AndroidRootTransparentRuntime(inspector)
            },
        )
        val bridge = AndroidTransparentRuntimeBridge(adapter)

        assertTrue(bridge.prepare(testConfig()).ok)
        inspector.active = true
        assertTrue(bridge.apply().ok)
        val verified = bridge.verify()
        val rolledBack = bridge.rollback()
        inspector.active = false

        assertTrue(verified.ok)
        assertEquals("verified", verified.reason)
        assertTrue(rolledBack.ok)
        assertEquals("rolled-back", rolledBack.state)
        assertTrue(executor.calls.isNotEmpty())
    }

    @Test
    fun applyRequiresPreparation() {
        val bridge = AndroidTransparentRuntimeBridge(adapterWithCapabilities(ready = true))

        val result = bridge.apply()

        assertFalse(result.ok)
        assertEquals("not-prepared", result.reason)
    }

    private fun adapterWithCapabilities(ready: Boolean): AndroidRootTransparentAdapter =
        AndroidRootTransparentAdapter(
            context = error("context not used in injected backend"),
            backend = object : AndroidRootTransparentAdapter.Backend {
                override fun inspect() = if (ready) readyCapabilities() else unavailableCapabilities()
                override fun createTransaction(config: RootTransparentConfig) =
                    error("must not create transaction")
                override fun createRuntime() = error("must not create runtime")
            },
        )

    private fun readyCapabilities() = AndroidRootTransparentAdapter.Capabilities(
        rootAvailable = true, rootAuthorized = true, systemVpnAvailable = true,
        tcp = true, udp = true, dns = true, icmp = false,
        ipv4 = true, ipv6 = true, uidIdentity = true,
        localOutputCapture = true, processIdentity = true,
        policyRouting = true, atomicRollback = true,
    )

    private fun unavailableCapabilities() = AndroidRootTransparentAdapter.Capabilities(
        rootAvailable = false, rootAuthorized = false, systemVpnAvailable = true,
        tcp = false, udp = false, dns = false, icmp = false,
        ipv4 = false, ipv6 = false, uidIdentity = false,
        localOutputCapture = false, processIdentity = false,
        policyRouting = false, atomicRollback = false,
    )

    private fun testConfig() = RootTransparentConfig(
        tableName = "angelanexus_bridge_test",
        mark = 1,
        routingTable = 100,
        ownerUid = 12345,
        interceptPort = 12345,
        dnsPort = 1053,
        ipv6 = true,
        selfLoopProtection = true,
    )

    private class RecordingExecutor : RootCommandExecutor {
        val calls = mutableListOf<String>()
        override fun execute(command: String) {
            calls += command
        }
    }

    private class MutableTransparentInspector : RootTransparentStateInspector {
        var active = false
        override fun tableExists(tableName: String) = active
        override fun ipv4PolicyRuleExists(mark: Int, routingTable: Int) = active
        override fun ipv4LocalRouteExists(routingTable: Int) = active
        override fun ipv6PolicyRuleExists(mark: Int, routingTable: Int) = active
        override fun ipv6LocalRouteExists(routingTable: Int) = active
        override fun interceptRulesExist(tableName: String, interceptPort: Int) = active
        override fun dnsRulesExist(tableName: String, dnsPort: Int?) = active
        override fun selfLoopProtectionExists(tableName: String, ipv6: Boolean) = active
    }
}
