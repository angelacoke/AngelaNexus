package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AndroidTransparentRuntimeBridgeTest {
    @Test
    fun unavailableRootCapabilityFailsClosed() {
        val adapter = adapterWithCapabilities(ready = false)
        val bridge = AndroidTransparentRuntimeBridge(adapter)

        val capability = bridge.inspectRootCapability()
        val prepared = bridge.prepare(testConfig())

        assertFalse(capability.supported)
        assertEquals("root-capability-unavailable", capability.reason)
        assertFalse(prepared.ok)
        assertEquals("idle", prepared.state)
    }

    @Test
    fun verifiedRootCapabilityPreparesAndAppliesOnlyThroughAdapter() {
        val transaction = FakeRootTransparentRuleTransaction()
        val adapter = AndroidRootTransparentAdapter(
            context = error("context not used in injected backend"),
            backend = object : AndroidRootTransparentAdapter.Backend {
                override fun inspect() = readyCapabilities()
                override fun createTransaction(config: RootTransparentConfig) = transaction
                override fun createRuntime() = AndroidRootTransparentRuntime(
                    object : RootTransparentStateInspector {
                        override fun tableExists(tableName: String) = true
                        override fun ipv4PolicyRuleExists(mark: Int, routingTable: Int) = true
                        override fun ipv4LocalRouteExists(routingTable: Int) = true
                        override fun ipv6PolicyRuleExists(mark: Int, routingTable: Int) = true
                        override fun ipv6LocalRouteExists(routingTable: Int) = true
                        override fun interceptRulesExist(tableName: String, interceptPort: Int) = true
                        override fun dnsRulesExist(tableName: String, dnsPort: Int?) = true
                        override fun selfLoopProtectionExists(tableName: String, ipv6: Boolean) = true
                    },
                )
            },
        )
        val bridge = AndroidTransparentRuntimeBridge(adapter)

        val prepared = bridge.prepare(testConfig())
        val applied = bridge.apply()
        val verified = bridge.verify()
        val rolledBack = bridge.rollback()

        assertTrue(prepared.ok)
        assertEquals("prepared", prepared.state)
        assertTrue(applied.ok)
        assertEquals("active", applied.state)
        assertTrue(verified.ok)
        assertEquals("verified", verified.reason)
        assertTrue(rolledBack.ok)
        assertEquals("rolled-back", rolledBack.state)
        assertEquals(1, transaction.prepareCalls)
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
        tableName = "angelanexus",
        mark = 0x1,
        routingTable = 100,
        interceptPort = 12345,
        dnsPort = 1053,
        ipv6 = true,
        selfLoopProtection = true,
    )

    private class FakeRootTransparentRuleTransaction : RootTransparentRuleTransaction {
        var prepareCalls = 0
        override fun prepare() { prepareCalls++ }
        override fun commitVerified(verify: () -> Boolean) {
            check(verify())
        }
        override fun rollbackCommitted() = true
    }
}
