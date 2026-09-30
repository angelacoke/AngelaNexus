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

    override fun dnsInterception(): Boolean =
        reversibleNftRuleCheck("udp dport 53 tproxy to :15053 meta mark set 1") &&
            reversibleNftRuleCheck("tcp dport 53 tproxy to :15053 meta mark set 1")

    override fun icmpCapture(): Boolean = false

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
            table="angelanexus_probe_${'$'}${'$'}"
            nft add table inet "${'$'}table"
            trap 'nft delete table inet "${'$'}table" >/dev/null 2>&1 || true' EXIT
            nft add chain inet "${'$'}table" prerouting { type filter hook prerouting priority -150; policy accept; }
            nft add rule inet "${'$'}table" prerouting ${'$'}rule
        """.trimIndent()
        return runner.run(command).succeeded
    }

    private fun reversiblePolicyRoutingCheck(ipCommand: String): Boolean {
        val command = """
            set -e
            ip_cmd="$ipCommand"
            base=51800
            table=${'$'}((base + ${'$'}${'$'} % 1000))
            mark=${'$'}(printf '0x5a%02x' ${'$'}((table % 256)))
            while ${'$'}ip_cmd route show table "${'$'}table" 2>/dev/null | grep -q . ||
                  ${'$'}ip_cmd rule show | grep -Eq "fwmark ${'$'}mark/0xffff.*lookup ${'$'}table"; do
              table=${'$'}((table + 1))
              mark=${'$'}(printf '0x5a%02x' ${'$'}((table % 256)))
              if [ "${'$'}table" -gt 52799 ]; then exit 2; fi
            done
            ${'$'}ip_cmd rule add fwmark "${'$'}mark"/0xffff lookup "${'$'}table"
            trap '${'$'}ip_cmd rule del fwmark "${'$'}mark"/0xffff lookup "${'$'}table" >/dev/null 2>&1 || true' EXIT
            if [ "$ipCommand" = "ip -6" ]; then
              ${'$'}ip_cmd route add local ::/0 dev lo table "${'$'}table"
              ${'$'}ip_cmd route del local ::/0 dev lo table "${'$'}table"
            else
              ${'$'}ip_cmd route add local 0.0.0.0/0 dev lo table "${'$'}table"
              ${'$'}ip_cmd route del local 0.0.0.0/0 dev lo table "${'$'}table"
            fi
        """.trimIndent()
        return runner.run(command).succeeded
    }

    private fun reversibleNftTransactionCheck(): Boolean {
        val command = """
            set -e
            table="angelanexus_probe_${'$'}${'$'}"
            nft add table inet "${'$'}table"
            trap 'nft delete table inet "${'$'}table" >/dev/null 2>&1 || true' EXIT
            nft add chain inet "${'$'}table" output { type filter hook output priority -150; policy accept; }
            nft add rule inet "${'$'}table" output meta mark 0x5a5a return
            nft delete table inet "${'$'}table"
            trap - EXIT
        """.trimIndent()
        return runner.run(command).succeeded
    }
}
