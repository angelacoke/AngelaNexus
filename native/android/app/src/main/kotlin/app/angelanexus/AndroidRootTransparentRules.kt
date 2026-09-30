package app.angelanexus

data class RootTransparentConfig(
    val interceptPort: Int,
    val mark: Int,
    val routingTable: Int,
    val ownerUid: Int,
    val dnsPort: Int? = null,
    val ipv6: Boolean = true,
) {
    init {
        require(interceptPort in 1..65535)
        require(mark in 1..0xFFFF)
        require(routingTable > 0)
        require(ownerUid >= 0)
        require(dnsPort == null || dnsPort in 1..65535)
    }
}

data class RootCommand(val apply: String, val rollback: String)

interface RootCommandExecutor {
    fun execute(command: String)
}

object AndroidRootTransparentRules {
    private const val TABLE = "angelanexus"
    private const val CHAIN = "prerouting"
    private const val OUTPUT = "output"
    private const val PRIORITY = "-150"

    fun build(config: RootTransparentConfig): List<RootCommand> {
        val commands = mutableListOf<RootCommand>()
        commands += nftCommands(config)
        commands += RootCommand(
            "ip rule add fwmark " + config.mark + " lookup " + config.routingTable,
            "ip rule del fwmark " + config.mark + " lookup " + config.routingTable,
        )
        commands += RootCommand(
            "ip route add local 0.0.0.0/0 dev lo table " + config.routingTable,
            "ip route del local 0.0.0.0/0 dev lo table " + config.routingTable,
        )
        if (config.ipv6) {
            commands += RootCommand(
                "ip -6 route add local ::/0 dev lo table " + config.routingTable,
                "ip -6 route del local ::/0 dev lo table " + config.routingTable,
            )
        }
        return commands
    }

    private fun nftCommands(config: RootTransparentConfig): List<RootCommand> {
        val commands = mutableListOf<RootCommand>()
        commands += RootCommand(
            "nft add table inet " + TABLE,
            "nft delete table inet " + TABLE,
        )
        commands += RootCommand(
            "nft add chain inet " + TABLE + " " + CHAIN +
                " { type filter hook prerouting priority " + PRIORITY + "; policy accept; }",
            "nft delete chain inet " + TABLE + " " + CHAIN,
        )
        commands += RootCommand(
            "nft add chain inet " + TABLE + " " + OUTPUT +
                " { type filter hook output priority " + PRIORITY + "; policy accept; }",
            "nft delete chain inet " + TABLE + " " + OUTPUT,
        )
        commands += RootCommand(
            "nft add rule inet " + TABLE + " " + OUTPUT +
                " meta skuid " + config.ownerUid + " return",
            "nft flush chain inet " + TABLE + " " + OUTPUT,
        )
        commands += RootCommand(
            "nft add rule inet " + TABLE + " " + OUTPUT +
                " tcp dport " + config.interceptPort + " return",
            "nft flush chain inet " + TABLE + " " + OUTPUT,
        )
        commands += RootCommand(
            "nft add rule inet " + TABLE + " " + CHAIN +
                " tcp dport != " + config.interceptPort +
                " tproxy to :" + config.interceptPort +
                " meta mark set " + config.mark,
            "nft flush chain inet " + TABLE + " " + CHAIN,
        )
        commands += RootCommand(
            "nft add rule inet " + TABLE + " " + CHAIN +
                " udp dport != " + config.interceptPort +
                " tproxy to :" + config.interceptPort +
                " meta mark set " + config.mark,
            "nft flush chain inet " + TABLE + " " + CHAIN,
        )
        if (config.dnsPort != null) {
            commands += RootCommand(
                "nft add rule inet " + TABLE + " " + CHAIN +
                    " udp dport 53 tproxy to :" + config.dnsPort +
                    " meta mark set " + config.mark,
                "nft flush chain inet " + TABLE + " " + CHAIN,
            )
        }
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
            applied.asReversed().forEach { command -> runCatching { executor.execute(command.rollback) } }
            prepared = false
            throw error
        }
    }

    fun rollback() {
        if (!prepared || committed) return
        commands.asReversed().forEach { command -> runCatching { executor.execute(command.rollback) } }
        prepared = false
    }
}
