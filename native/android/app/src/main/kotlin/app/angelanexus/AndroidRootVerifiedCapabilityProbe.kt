package app.angelanexus

/**
 * Runtime evidence probe for the Android/Linux Root transparent backend.
 *
 * The probe performs isolated, reversible capability checks. It never treats
 * command presence or syntax validation alone as proof of a working feature.
 * Process identity remains an explicit capability because nftables UID matching
 * is not the same thing as process identity.
 */
data class RootProbeResult(
    val exitCode: Int,
    val stdout: String = "",
    val stderr: String = "",
) {
    val succeeded: Boolean get() = exitCode == 0
}

interface AndroidRootProbeRunner {
    fun run(command: String): RootProbeResult
}

interface AndroidRootProcessIdentityEvidence {
    fun isAvailable(): Boolean
}

object UnverifiedAndroidRootProcessIdentityEvidence : AndroidRootProcessIdentityEvidence {
    override fun isAvailable() = false
}

class AndroidRootVerifiedCapabilityProbe(
    private val runner: AndroidRootProbeRunner,
    private val processIdentityEvidence: AndroidRootProcessIdentityEvidence =
        UnverifiedAndroidRootProcessIdentityEvidence,
) : AndroidRootCapabilityProbe {

    override fun tcpTproxy(): Boolean = reversibleNftRuleCheck(
        "tcp dport 443 tproxy to :15001 meta mark set 1"
    )

    override fun udpTproxy(): Boolean = reversibleNftRuleCheck(
        "udp dport 443 tproxy to :15001 meta mark set 1"
    )

    override fun dnsInterception(): Boolean = reversibleNftRuleCheck(
        "udp dport 53 tproxy to :15053 meta mark set 1"
    )

    override fun ipv4PolicyRouting(): Boolean =
        reversiblePolicyRoutingCheck("ip -4")

    override fun ipv6PolicyRouting(): Boolean =
        reversiblePolicyRoutingCheck("ip -6")

    override fun uidIdentity(): Boolean = reversibleNftRuleCheck(
        "meta skuid 0 return"
    )

    override fun processIdentity(): Boolean =
        processIdentityEvidence.isAvailable()

    override fun atomicRollback(): Boolean =
        reversibleNftTransactionCheck()

    private fun reversibleNftRuleCheck(rule: String): Boolean {
        val command = """
            set -e
            table="angelanexus_probe_$$"
            nft add table inet "$table"
            trap 'nft delete table inet "$table" >/dev/null 2>&1 || true' EXIT
            nft add chain inet "$table" prerouting { type filter hook prerouting priority -150; policy accept; }
            nft add rule inet "$table" prerouting $rule
        """.trimIndent()
        return runner.run(command).succeeded
    }

    private fun reversiblePolicyRoutingCheck(ipCommand: String): Boolean {
        val command = """
            set -e
            base=51800
            table=$((base + $$ % 1000))
            while ip -4 route show table "$table" | grep -q .; do
              table=$((table + 1))
              if [ "$table" -gt 52799 ]; then exit 2; fi
            done
            mark="0x5a5a"
            $ipCommand rule add fwmark "$mark"/0xffff lookup "$table"
            trap '$ipCommand rule del fwmark "$mark"/0xffff lookup "$table" >/dev/null 2>&1 || true' EXIT
            $ipCommand route add local 0.0.0.0/0 dev lo table "$table"
            if [ "$ipCommand" = "ip -6" ]; then
              $ipCommand -6 route add local ::/0 dev lo table "$table"
              $ipCommand -6 route del local ::/0 dev lo table "$table"
            fi
            $ipCommand route del local 0.0.0.0/0 dev lo table "$table"
        """.trimIndent()
        return runner.run(command).succeeded
    }

    private fun reversibleNftTransactionCheck(): Boolean {
        val command = """
            set -e
            table="angelanexus_probe_$$"
            nft add table inet "$table"
            trap 'nft delete table inet "$table" >/dev/null 2>&1 || true' EXIT
            nft add chain inet "$table" output { type filter hook output priority -150; policy accept; }
            nft add rule inet "$table" output meta mark 0x5a5a return
            nft delete table inet "$table"
            trap - EXIT
        """.trimIndent()
        return runner.run(command).succeeded
    }
}
