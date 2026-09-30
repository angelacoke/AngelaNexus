package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AndroidRootTransparentStateInspectorTest {
    private class FakeRunner(private val successfulFragments: Set<String>) : AndroidRootProbeRunner {
        val commands = mutableListOf<String>()

        override fun run(command: String): RootProbeResult {
            commands += command
            return if (successfulFragments.any(command::contains)) {
                RootProbeResult(0)
            } else {
                RootProbeResult(1)
            }
        }
    }

    @Test
    fun live_state_requires_both_protocols_and_both_ip_families() {
        val runner = FakeRunner(
            setOf(
                "nft list table inet angelanexus",
                "fwmark 1/0xffff lookup 100",
                "local 0.0.0.0/0 dev lo",
                "local ::/0 dev lo",
                "tcp dport != 15001 tproxy to :15001",
                "udp dport != 15001 tproxy to :15001",
                "udp dport 53 tproxy to :15053",
                "tcp dport 53 tproxy to :15053",
                "output ip daddr 127.0.0.0/8 return",
                "ip daddr 127.0.0.0/8 return",
                "output ip6 daddr ::1/128 return",
                "ip6 daddr ::1/128 return",
            ),
        )
        val inspector = AndroidRootTransparentStateInspector(runner)

        assertTrue(inspector.tableExists("angelanexus"))
        assertTrue(inspector.ipv4PolicyRuleExists(1, 100))
        assertTrue(inspector.ipv4LocalRouteExists(100))
        assertTrue(inspector.ipv6PolicyRuleExists(1, 100))
        assertTrue(inspector.ipv6LocalRouteExists(100))
        assertTrue(inspector.interceptRulesExist("angelanexus", 15001))
        assertTrue(inspector.dnsRulesExist("angelanexus", 15053))
        assertTrue(inspector.selfLoopProtectionExists("angelanexus", true))
    }

    @Test
    fun missing_dns_rule_is_not_reported_as_active() {
        val runner = FakeRunner(
            setOf(
                "udp dport 53 tproxy to :15053",
            ),
        )
        val inspector = AndroidRootTransparentStateInspector(runner)

        assertFalse(inspector.dnsRulesExist("angelanexus", 15053))
    }
}
