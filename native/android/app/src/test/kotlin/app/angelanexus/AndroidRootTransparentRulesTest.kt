package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class AndroidRootTransparentRulesTest {
    private class FakeExecutor(private val failOn: String? = null) : RootCommandExecutor {
        val calls = mutableListOf<String>()
        override fun execute(command: String) {
            calls += command
            if (command == failOn) error("command failed")
        }
    }

    private fun config() = RootTransparentConfig(15001, 1, 100, 12345, 15053, true)

    @Test
    fun plan_contains_capture_policy_route_and_loop_protection() {
        val apply = AndroidRootTransparentRules.build(config()).map { it.apply }
        assertTrue(apply.any { it.contains("tproxy to :15001") })
        assertTrue(apply.any { it.contains("fwmark 1 lookup 100") })
        assertTrue(apply.any { it.contains("local ::/0 dev lo") })
        assertTrue(apply.any { it.contains("meta skuid 12345 return") })
        assertTrue(apply.any { it.contains("dport 15001 return") })
    }

    @Test
    fun transaction_rolls_back_applied_commands_on_failure() {
        val commands = AndroidRootTransparentRules.build(config()).take(3)
        val executor = FakeExecutor(commands[2].apply)
        val tx = RootTransparentRuleTransaction(executor, commands)
        tx.prepare()
        assertFailsWith<IllegalStateException> { tx.commit() }
        assertTrue(executor.calls.contains(commands[1].rollback))
        assertTrue(executor.calls.contains(commands[0].rollback))
    }

    @Test
    fun transaction_commits_in_order() {
        val commands = AndroidRootTransparentRules.build(config()).take(2)
        val executor = FakeExecutor()
        val tx = RootTransparentRuleTransaction(executor, commands)
        tx.prepare()
        tx.commit()
        assertEquals(commands.map { it.apply }, executor.calls)
    }
}
