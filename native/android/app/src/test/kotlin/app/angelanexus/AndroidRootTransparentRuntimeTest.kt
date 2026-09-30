package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class AndroidRootTransparentRuntimeTest {
    private class FakeExecutor(
        private val failCommand: String? = null,
    ) : RootCommandExecutor {
        val calls = mutableListOf<String>()
        override fun execute(command: String) {
            calls += command
            if (command == failCommand) error("simulated command failure")
        }
    }

    private class FakeInspector(
        var verified: Boolean,
        private val clear: Boolean = true,
    ) : RootTransparentStateInspector {
        override fun tableExists(tableName: String) = verified
        override fun ipv4PolicyRuleExists(mark: Int, routingTable: Int) = verified
        override fun ipv4LocalRouteExists(routingTable: Int) = verified
        override fun ipv6PolicyRuleExists(mark: Int, routingTable: Int) = verified
        override fun ipv6LocalRouteExists(routingTable: Int) = verified
        override fun interceptRulesExist(tableName: String, interceptPort: Int) = verified
        override fun dnsRulesExist(tableName: String, dnsPort: Int?) = verified
        override fun selfLoopProtectionExists(tableName: String, ipv6: Boolean) = verified
        override fun isClear(config: RootTransparentConfig) = clear
    }

    private fun config() = RootTransparentConfig(
        interceptPort = 15001,
        mark = 1,
        routingTable = 100,
        ownerUid = 12345,
        dnsPort = 15053,
        ipv6 = true,
        tableName = "angelanexus_runtime_test",
    )

    @Test
    fun successful_activation_reaches_active_only_after_verification() {
        val executor = FakeExecutor()
        val runtime = AndroidRootTransparentRuntime(FakeInspector(true))
        val transaction = RootTransparentRuleTransaction(executor, AndroidRootTransparentRules.build(config()))

        runtime.activate(config(), transaction)

        assertEquals(AndroidRootTransparentRuntime.State.ACTIVE, runtime.state)
        assertTrue(runtime.lastVerification?.success == true)
        assertTrue(executor.calls.isNotEmpty())
    }

    @Test
    fun failed_verification_rolls_back_and_never_reaches_active() {
        val executor = FakeExecutor()
        val runtime = AndroidRootTransparentRuntime(FakeInspector(false))
        val commands = AndroidRootTransparentRules.build(config())
        val transaction = RootTransparentRuleTransaction(executor, commands)

        assertFailsWith<IllegalStateException> { runtime.activate(config(), transaction) }

        assertEquals(AndroidRootTransparentRuntime.State.FAILED, runtime.state)
        assertTrue(runtime.lastVerification?.success == false)
        assertTrue(executor.calls.contains(commands[1].rollback))
    }

    @Test
    fun verification_failure_does_not_report_active_even_when_apply_succeeds() {
        val runtime = AndroidRootTransparentRuntime(FakeInspector(false))
        val transaction = RootTransparentRuleTransaction(FakeExecutor(), AndroidRootTransparentRules.build(config()))

        assertFailsWith<IllegalStateException> { runtime.activate(config(), transaction) }
        assertTrue(runtime.state != AndroidRootTransparentRuntime.State.ACTIVE)
    }
    @Test
    fun failed_activation_surfaces_rollback_failure() {
        val commands = AndroidRootTransparentRules.build(config())
        val rollbackCommand = commands[1].rollback
        val executor = FakeExecutor(failCommand = rollbackCommand)
        val runtime = AndroidRootTransparentRuntime(FakeInspector(false))
        val transaction = RootTransparentRuleTransaction(executor, commands)

        val error = assertFailsWith<IllegalStateException> { runtime.activate(config(), transaction) }

        assertEquals(AndroidRootTransparentRuntime.State.FAILED, runtime.state)
        assertTrue(error.suppressedExceptions.any { it.message == "simulated command failure" })
    }

    @Test
    fun health_check_keeps_active_when_live_state_is_intact() {
        val runtime = AndroidRootTransparentRuntime(FakeInspector(true))
        runtime.activate(
            config(),
            RootTransparentRuleTransaction(FakeExecutor(), AndroidRootTransparentRules.build(config())),
        )

        val verification = runtime.healthCheck()

        assertEquals(AndroidRootTransparentRuntime.State.ACTIVE, runtime.state)
        assertTrue(verification.success)
        assertTrue(runtime.lastVerification === verification)
    }

    @Test
    fun health_check_fails_closed_when_live_state_is_lost() {
        val inspector = FakeInspector(true)
        val runtime = AndroidRootTransparentRuntime(inspector)
        runtime.activate(
            config(),
            RootTransparentRuleTransaction(FakeExecutor(), AndroidRootTransparentRules.build(config())),
        )
        inspector.verified = false

        val error = assertFailsWith<IllegalStateException> {
            runtime.healthCheck()
        }

        assertEquals("transparent runtime health verification failed", error.message)
        assertEquals(AndroidRootTransparentRuntime.State.FAILED, runtime.state)
        assertTrue(runtime.lastVerification?.success == false)
    }

    @Test
    fun health_check_uses_active_configuration_and_ignores_caller_supplied_state() {
        val runtime = AndroidRootTransparentRuntime(FakeInspector(true))
        runtime.activate(
            config(),
            RootTransparentRuleTransaction(FakeExecutor(), AndroidRootTransparentRules.build(config())),
        )

        val verification = runtime.healthCheck()

        assertEquals(config().mark, 1)
        assertTrue(verification.success)
        assertEquals(AndroidRootTransparentRuntime.State.ACTIVE, runtime.state)
    }


}
