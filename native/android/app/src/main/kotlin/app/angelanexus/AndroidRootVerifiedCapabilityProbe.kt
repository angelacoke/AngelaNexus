package app.angelanexus

/**
 * Runtime evidence probe for the Android/Linux Root transparent backend.
 *
 * The probe performs only isolated, reversible capability checks. It never
 * treats command presence as proof of a working feature. Process identity
 * remains an explicit capability because nftables UID matching is not the
 * same thing as process identity.
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

    override fun tcpTproxy(): Boolean = nftCheck(
        "tcp dport 443 tproxy to :15001 meta mark set 1"
    )

    override fun udpTproxy(): Boolean = nftCheck(
        "udp dport 443 tproxy to :15001 meta mark set 1"
    )

    override fun dnsInterception(): Boolean = nftCheck(
        "udp dport 53 tproxy to :15053 meta mark set 1"
    )

    override fun ipv4PolicyRouting(): Boolean =
        reversiblePolicyRoutingCheck("ip -4")

    override fun ipv6PolicyRouting(): Boolean =
        reversiblePolicyRoutingCheck("ip -6")

    override fun uidIdentity(): Boolean = nftCheck(
        "meta skuid 0 return"
    )

    override fun processIdentity(): Boolean =
        processIdentityEvidence.isAvailable()

    override fun atomicRollback(): Boolean =
        reversibleNftTransactionCheck()

    private fun nftCheck(rule: String): Boolean {
        val table = "angelanexus_probe"
        val command = """
            set -e
            nft -c "add table inet $table; add chain inet $table prerouting { type filter hook prerouting priority -150; policy accept; }; add rule inet $table prerouting $rule"
        """.trimIndent()
        return runner.run(command).succeeded
    }

    private fun reversiblePolicyRoutingCheck(ipCommand: String): Boolean {
        val table = 199
        val mark = "0x5a5a"
        val command = """
            set -e
            $ipCommand rule add fwmark $mark/0xffff lookup $table
            $ipCommand rule del fwmark $mark/0xffff lookup $table
        """.trimIndent()
        return runner.run(command).succeeded
    }

    private fun reversibleNftTransactionCheck(): Boolean {
        val table = "angelanexus_probe"
        val command = """
            set -e
            if nft list table inet $table >/dev/null 2>&1; then exit 2; fi
            nft add table inet $table
            nft add chain inet $table output { type filter hook output priority -150; policy accept; }
            nft add rule inet $table output meta mark 0x5a5a return
            nft delete table inet $table
        """.trimIndent()
        return runner.run(command).succeeded
    }
}
