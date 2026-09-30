package app.angelanexus

data class RootTransparentConfig(
    val interceptPort: Int,
    val mark: Int,
    val routingTable: Int,
    val ownerUid: Int,
    val dnsPort: Int? = null,
    val ipv6: Boolean = true,
    val tableName: String = "angelanexus",
    val bypassIpv4: List<String> = emptyList(),
    val bypassIpv6: List<String> = emptyList(),
) {
    init {
        require(interceptPort in 1..65535)
        require(mark in 1..0xFFFF)
        require(routingTable > 0)
        require(ownerUid >= 0)
        require(dnsPort == null || dnsPort in 1..65535)
        require(tableName.matches(Regex("[a-z][a-z0-9_]{0,30}")))
    }
}

data class RootCommand(val apply: String, val rollback: String)

interface RootCommandExecutor {
    fun execute(command: String)
}

object AndroidRootTransparentRules {
    private const val CHAIN = "prerouting"
    private const val OUTPUT = "output"
    private const val PRIORITY = "-150"

    fun build(config: RootTransparentConfig): List<RootCommand> {
        val commands = mutableListOf<RootCommand>()
        commands += nftCommands(config)
        commands += RootCommand(
            "ip rule add fwmark ${config.mark}/0xffff lookup ${config.routingTable}",
            "ip rule del fwmark ${config.mark}/0xffff lookup ${config.routingTable}",
        )
        commands += RootCommand(
            "ip route add local 0.0.0.0/0 dev lo table ${config.routingTable}",
            "ip route del local 0.0.0.0/0 dev lo table ${config.routingTable}",
        )
        if (config.ipv6) {
            commands += RootCommand(
                "ip -6 route add local ::/0 dev lo table ${config.routingTable}",
                "ip -6 route del local ::/0 dev lo table ${config.routingTable}",
            )
        }
        return commands
    }

    private fun nftCommands(config: RootTransparentConfig): List<RootCommand> {
        val commands = mutableListOf<RootCommand>()
        val table = config.tableName
        commands += RootCommand("nft add table inet $table", "nft delete table inet $table")
        commands += RootCommand(
            "nft add chain inet $table $CHAIN { type filter hook prerouting priority $PRIORITY; policy accept; }",
            "nft delete chain inet $table $CHAIN",
        )
        commands += RootCommand(
            "nft add chain inet $table $OUTPUT { type filter hook output priority $PRIORITY; policy accept; }",
            "nft delete chain inet $table $OUTPUT",
        )
        commands += RootCommand(
            "nft add rule inet $table $OUTPUT meta skuid ${config.ownerUid} return",
            "",
        )
        commands += RootCommand(
            "nft add rule inet $table $OUTPUT tcp dport ${config.interceptPort} return",
            "",
        )
        commands += RootCommand(
            "nft add rule inet $table $OUTPUT udp dport ${config.interceptPort} return",
            "",
        )
        config.bypassIpv4.forEach { cidr ->
            commands += RootCommand("nft add rule inet $table $CHAIN ip daddr $cidr return", "")
        }
        if (config.ipv6) {
            config.bypassIpv6.forEach { cidr ->
                commands += RootCommand("nft add rule inet $table $CHAIN ip6 daddr $cidr return", "")
            }
        }
        if (config.dnsPort != null) {
            commands += RootCommand(
                "nft add rule inet $table $CHAIN udp dport 53 tproxy to :${config.dnsPort} meta mark set ${config.mark}",
                "",
            )
        }
        commands += RootCommand(
            "nft add rule inet $table $CHAIN tcp dport != ${config.interceptPort} tproxy to :${config.interceptPort} meta mark set ${config.mark}",
            "",
        )
        commands += RootCommand(
            "nft add rule inet $table $CHAIN udp dport != ${config.interceptPort} tproxy to :${config.interceptPort} meta mark set ${config.mark}",
            "",
        )
        return commands
    }
}

class RootTransparentRuleTransaction(
    private val executor: RootCommandExecutor,
    private val commands: List<RootCommand>,
) {
    private var prepared = false
    private var committed = false

    fun prepare() {
        check(!prepared && !committed) { "transaction is not reusable" }
        require(commands.isNotEmpty()) { "transparent rule set is empty" }
        prepared = true
    }

    fun commit() {
        check(prepared && !committed) { "transaction is not prepared" }
        val applied = mutableListOf<RootCommand>()
        try {
            for (command in commands) {
                executor.execute(command.apply)
                applied += command
            }
            committed = true
        } catch (error: Throwable) {
            applied.asReversed().forEach { command ->
                if (command.rollback.isNotBlank()) runCatching { executor.execute(command.rollback) }
            }
            prepared = false
            throw error
        }
    }

    fun rollback() {
        if (!prepared || committed) return
        commands.asReversed().forEach { command ->
            if (command.rollback.isNotBlank()) runCatching { executor.execute(command.rollback) }
        }
        prepared = false
    }
}
