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
    val protectedUids: List<Int> = emptyList(),
    val protectedPorts: List<Int> = emptyList(),
) {
    init {
        require(interceptPort in 1..65535)
        require(mark in 1..0xFFFF)
        require(routingTable > 0)
        require(ownerUid >= 0)
        require(dnsPort == null || dnsPort in 1..65535)
        require(tableName.matches(Regex("[a-z][a-z0-9_]{0,30}")))
        require(protectedUids.all { it >= 0 })
        require(protectedPorts.all { it in 1..65535 })
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
    private const val TABLE_EXISTS_EXIT = 73

    fun build(config: RootTransparentConfig): List<RootCommand> {
        val commands = mutableListOf<RootCommand>()
        commands += RootCommand(
            "nft list table inet \${config.tableName} >/dev/null 2>&1 && exit \$TABLE_EXISTS_EXIT || exit 0",
            "",
        )
        commands += nftCommands(config)
        commands += RootCommand(
            "ip rule add fwmark \${config.mark}/0xffff lookup \${config.routingTable}",
            "ip rule del fwmark \${config.mark}/0xffff lookup \${config.routingTable}",
        )
        commands += RootCommand(
            "ip route add local 0.0.0.0/0 dev lo table \${config.routingTable}",
            "ip route del local 0.0.0.0/0 dev lo table \${config.routingTable}",
        )
        if (config.ipv6) {
            commands += RootCommand(
                "ip -6 route add local ::/0 dev lo table \${config.routingTable}",
                "ip -6 route del local ::/0 dev lo table \${config.routingTable}",
            )
        }
        return commands
    }

    private fun nftCommands(config: RootTransparentConfig): List<RootCommand> {
        val commands = mutableListOf<RootCommand>()
        val table = config.tableName
        commands += RootCommand("nft add table inet \$table", "nft delete table inet \$table")
        commands += RootCommand(
            "nft add chain inet \$table \$CHAIN { type filter hook prerouting priority \$PRIORITY; policy accept; }",
            "nft delete chain inet \$table \$CHAIN",
        )
        commands += RootCommand(
            "nft add chain inet \$table \$OUTPUT { type filter hook output priority \$PRIORITY; policy accept; }",
            "nft delete chain inet \$table \$OUTPUT",
        )
        config.protectedUids.distinct().forEach { uid ->
            commands += RootCommand(
                "nft add rule inet \$table \$OUTPUT meta skuid \$uid return",
                "",
            )
        }
        commands += RootCommand(
            "nft add rule inet \$table \$OUTPUT meta skuid \${config.ownerUid} return",
            "",
        )
        config.protectedPorts.distinct().forEach { port ->
            commands += RootCommand(
                "nft add rule inet \$table \$OUTPUT tcp dport \$port return",
                "",
            )
            commands += RootCommand(
                "nft add rule inet \$table \$OUTPUT udp dport \$port return",
                "",
            )
        }
        commands += RootCommand(
            "nft add rule inet \$table \$OUTPUT meta mark \${config.mark} return",
            "",
        )
        commands += RootCommand(
            "nft add rule inet \$table \$OUTPUT tcp dport \${config.interceptPort} return",
            "",
        )
        commands += RootCommand(
            "nft add rule inet \$table \$OUTPUT udp dport \${config.interceptPort} return",
            "",
        )
        config.bypassIpv4.forEach { cidr ->
            commands += RootCommand("nft add rule inet \$table \$CHAIN ip daddr \$cidr return", "")
        }
        if (config.ipv6) {
            config.bypassIpv6.forEach { cidr ->
                commands += RootCommand("nft add rule inet \$table \$CHAIN ip6 daddr \$cidr return", "")
            }
        }
        if (config.dnsPort != null) {
            commands += RootCommand(
                "nft add rule inet \$table \$CHAIN udp dport 53 tproxy to :\${config.dnsPort} meta mark set \${config.mark}",
                "",
            )
        }
        commands += RootCommand(
            "nft add rule inet \$table \$CHAIN tcp dport != \${config.interceptPort} tproxy to :\${config.interceptPort} meta mark set \${config.mark}",
            "",
        )
        commands += RootCommand(
            "nft add rule inet \$table \$CHAIN udp dport != \${config.interceptPort} tproxy to :\${config.interceptPort} meta mark set \${config.mark}",
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
    private val appliedCommands = mutableListOf<RootCommand>()

    fun prepare() {
        check(!prepared && !committed) { "transaction is not reusable" }
        require(commands.isNotEmpty()) { "transparent rule set is empty" }
        prepared = true
        appliedCommands.clear()
    }

    fun commit() {
        check(prepared && !committed) { "transaction is not prepared" }
        try {
            for (command in commands) {
                executor.execute(command.apply)
                appliedCommands += command
            }
            committed = true
        } catch (error: Throwable) {
            rollbackApplied()
            prepared = false
            throw error
        }
    }

    fun rollback() {
        if (!prepared || committed) return
        rollbackApplied()
        prepared = false
    }

    private fun rollbackApplied() {
        appliedCommands.asReversed().forEach { command ->
            if (command.rollback.isNotBlank()) runCatching { executor.execute(command.rollback) }
        }
        appliedCommands.clear()
    }
}
