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

    private fun config() = RootTransparentConfig(
        interceptPort = 15001,
        mark = 1,
        routingTable = 100,
        ownerUid = 12345,
        dnsPort = 15053,
        ipv6 = true,
        tableName = "angelanexus_test",
        bypassIpv4 = listOf("127.0.0.0/8", "10.0.0.0/8"),
        bypassIpv6 = listOf("::1/128", "fc00::/7"),
        protectedUids = listOf(2000),
        protectedPorts = listOf(15053),
    )

    @Test
    fun plan_contains_capture_policy_route_and_loop_protection() {
        val apply = AndroidRootTransparentRules.build(config()).map { it.apply }
        assertTrue(apply.first().contains("nft list table inet angelanexus_test"))
        assertTrue(apply.any { it.contains("tproxy to :15001") })
        assertTrue(apply.any { it.contains("fwmark 1/0xffff lookup 100") })
        assertTrue(apply.any { it.contains("local ::/0 dev lo") })
        assertTrue(apply.any { it.contains("meta skuid 12345 return") })
        assertTrue(apply.any { it.contains("meta skuid 2000 return") })
        assertTrue(apply.any { it.contains("tcp dport 15053 return") })
        assertTrue(apply.any { it.contains("udp dport 53 tproxy to :15053") })
        assertTrue(apply.any { it.contains("tcp dport 53 tproxy to :15053") })
        assertTrue(apply.any { it.contains("meta mark 1 return") })
        assertTrue(apply.any { it.contains("dport 15001 return") })
        assertTrue(apply.any { it.contains("ip daddr 127.0.0.0/8 return") })
        assertTrue(apply.any { it.contains("ip6 daddr fc00::/7 return") })
    }

    @Test
    fun bypass_cidr_rejects_shell_injection_and_invalid_family() {
        assertFailsWith<IllegalArgumentException> {
            RootTransparentConfig(
                interceptPort = 15001,
                mark = 1,
                routingTable = 100,
                ownerUid = 12345,
                bypassIpv4 = listOf("127.0.0.0/8; touch /tmp/pwned"),
            )
        }
        assertFailsWith<IllegalArgumentException> {
            RootTransparentConfig(
                interceptPort = 15001,
                mark = 1,
                routingTable = 100,
                ownerUid = 12345,
                bypassIpv4 = listOf("::1/128"),
            )
        }
        assertFailsWith<IllegalArgumentException> {
            RootTransparentConfig(
                interceptPort = 15001,
                mark = 1,
                routingTable = 100,
                ownerUid = 12345,
                bypassIpv6 = listOf("10.0.0.0/8"),
            )
        }
    }
    @Test
    fun rollback_without_commit_does_not_execute_unapplied_commands() {
        val commands = AndroidRootTransparentRules.build(config()).take(3)
        val executor = FakeExecutor()
        val tx = RootTransparentRuleTransaction(executor, commands)
        tx.prepare()
        tx.rollback()
        assertTrue(executor.calls.isEmpty())
    }

    @Test
    fun transaction_rolls_back_applied_commands_on_failure() {
        val commands = AndroidRootTransparentRules.build(config()).take(4)
        val executor = FakeExecutor(commands[3].apply)
        val tx = RootTransparentRuleTransaction(executor, commands)
        tx.prepare()
        assertFailsWith<IllegalStateException> { tx.commit() }
        assertTrue(executor.calls.contains(commands[2].rollback))
        assertTrue(executor.calls.contains(commands[1].rollback))
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
