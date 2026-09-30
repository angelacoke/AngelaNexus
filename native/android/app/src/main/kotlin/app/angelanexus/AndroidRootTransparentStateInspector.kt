package app.angelanexus

/**
 * Reads the live kernel state created by the Root transparent transaction.
 *
 * This class only reports positive evidence from nft/ip. It never assumes
 * that a successful command means the requested state exists.
 */
class AndroidRootTransparentStateInspector(
    private val runner: AndroidRootProbeRunner,
) : RootTransparentStateInspector {
    override fun tableExists(tableName: String): Boolean =
        succeeds("nft list table inet $tableName")

    override fun ipv4PolicyRuleExists(mark: Int, routingTable: Int): Boolean =
        succeeds("ip -4 rule show | grep -F 'fwmark ${mark}/0xffff lookup $routingTable'")

    override fun ipv4LocalRouteExists(routingTable: Int): Boolean =
        succeeds("ip -4 route show table $routingTable | grep -F 'local 0.0.0.0/0 dev lo'")

    override fun ipv6PolicyRuleExists(mark: Int, routingTable: Int): Boolean =
        succeeds("ip -6 rule show | grep -F 'fwmark ${mark}/0xffff lookup $routingTable'")

    override fun ipv6LocalRouteExists(routingTable: Int): Boolean =
        succeeds("ip -6 route show table $routingTable | grep -F 'local ::/0 dev lo'")

    override fun interceptRulesExist(tableName: String, interceptPort: Int): Boolean {
        val tcp = succeeds(
            "nft list table inet $tableName | grep -F 'tcp dport != $interceptPort tproxy to :$interceptPort'",
        )
        val udp = succeeds(
            "nft list table inet $tableName | grep -F 'udp dport != $interceptPort tproxy to :$interceptPort'",
        )
        return tcp && udp
    }

    override fun dnsRulesExist(tableName: String, dnsPort: Int?): Boolean {
        if (dnsPort == null) return true
        val udp = succeeds(
            "nft list table inet $tableName | grep -F 'udp dport 53 tproxy to :$dnsPort'",
        )
        val tcp = succeeds(
            "nft list table inet $tableName | grep -F 'tcp dport 53 tproxy to :$dnsPort'",
        )
        return udp && tcp
    }

    override fun selfLoopProtectionExists(tableName: String, ipv6: Boolean): Boolean {
        val ipv4Output = succeeds(
            "nft list table inet $tableName | grep -F 'output ip daddr 127.0.0.0/8 return'",
        )
        val ipv4Prerouting = succeeds(
            "nft list table inet $tableName | grep -F 'ip daddr 127.0.0.0/8 return'",
        )
        if (!ipv6) return ipv4Output && ipv4Prerouting

        val ipv6Output = succeeds(
            "nft list table inet $tableName | grep -F 'output ip6 daddr ::1/128 return'",
        )
        val ipv6Prerouting = succeeds(
            "nft list table inet $tableName | grep -F 'ip6 daddr ::1/128 return'",
        )
        return ipv4Output && ipv4Prerouting && ipv6Output && ipv6Prerouting
    }

    private fun succeeds(command: String): Boolean = runner.run(command).succeeded
}
