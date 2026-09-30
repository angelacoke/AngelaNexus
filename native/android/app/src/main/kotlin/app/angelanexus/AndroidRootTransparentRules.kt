package app.angelanexus

import java.net.InetAddress

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
    val selfLoopProtection: Boolean = true,
) {
    init {
        require(interceptPort in 1..65535)
        require(mark in 1..0xFFFF)
        require(routingTable > 0)
        require(ownerUid >= 0)
        require(dnsPort == null || dnsPort in 1..65535)
        require(dnsPort == null || dnsPort != interceptPort)
        require(tableName.matches(Regex("[a-z][a-z0-9_]{0,30}")))
        require(protectedUids.all { it >= 0 })
        require(protectedPorts.all { it in 1..65535 })
        bypassIpv4.forEach { validateBypassCidr(it, ipv4 = true) }
        bypassIpv6.forEach { validateBypassCidr(it, ipv4 = false) }
    }
}

private fun validateBypassCidr(value: String, ipv4: Boolean) {
    require(value.isNotBlank())
    val parts = value.split("/")
    require(parts.size == 2)
    val address = parts[0]
    val prefix = parts[1].toIntOrNull() ?: error("invalid CIDR prefix")
    require(address.matches(Regex("[0-9A-Fa-f:.]+")))
    require(prefix in if (ipv4) 0..32 else 0..128)
    val parsed = runCatching { InetAddress.getByName(address) }.getOrNull()
        ?: error("invalid CIDR address")
    require(parsed.address.size == if (ipv4) 4 else 16)
}

data class RootCommand(val apply: String, val rollback: String)

interface RootCommandExecutor {
    fun execute(command: String)
}

object AndroidRootTransparentRules {
    private const val CHAIN = "prerouting"
    private const val OUTPUT = "output"
    private const val PRIORITY = -150
    private const val TABLE_EXISTS_EXIT = 73

    fun build(config: RootTransparentConfig): List<RootCommand> {
        val commands = mutableListOf<RootCommand>()

        commands += RootCommand(
            apply = "if nft list table inet ${config.tableName} >/dev/null 2>&1; then exit $TABLE_EXISTS_EXIT; fi",
            rollback = "",
        )
        commands += nftCommands(config)

        commands += RootCommand(
            apply = "ip rule add fwmark ${config.mark}/0xffff lookup ${config.routingTable}",
            rollback = "ip rule del fwmark ${config.mark}/0xffff lookup ${config.routingTable}",
        )
        commands += RootCommand(
            apply = "ip route add local 0.0.0.0/0 dev lo table ${config.routingTable}",
            rollback = "ip route del local 0.0.0.0/0 dev lo table ${config.routingTable}",
        )
        if (config.ipv6) {
            commands += RootCommand(
                apply = "ip -6 rule add fwmark ${config.mark}/0xffff lookup ${config.routingTable}",
                rollback = "ip -6 rule del fwmark ${config.mark}/0xffff lookup ${config.routingTable}",
            )
            commands += RootCommand(
                apply = "ip -6 route add local ::/0 dev lo table ${config.routingTable}",
                rollback = "ip -6 route del local ::/0 dev lo table ${config.routingTable}",
            )
        }
        return commands
    }

    private fun nftCommands(config: RootTransparentConfig): List<RootCommand> {
        val table = config.tableName
        val commands = mutableListOf<RootCommand>()

        commands += RootCommand(
            apply = "nft add table inet $table",
            rollback = "nft delete table inet $table",
        )
        commands += RootCommand(
            apply = "nft add chain inet $table $CHAIN { type filter hook prerouting priority $PRIORITY; policy accept; }",
            rollback = "nft delete chain inet $table $CHAIN",
        )
        commands += RootCommand(
            apply = "nft add chain inet $table $OUTPUT { type filter hook output priority $PRIORITY; policy accept; }",
            rollback = "nft delete chain inet $table $OUTPUT",
        )

        config.protectedUids.distinct().forEach { uid ->
            commands += RootCommand("nft add rule inet $table $OUTPUT meta skuid $uid return", "")
        }
        commands += RootCommand("nft add rule inet $table $OUTPUT meta skuid ${config.ownerUid} return", "")

        config.protectedPorts.distinct().forEach { port ->
            commands += RootCommand("nft add rule inet $table $OUTPUT tcp dport $port return", "")
            commands += RootCommand("nft add rule inet $table $OUTPUT udp dport $port return", "")
        }
        commands += RootCommand("nft add rule inet $table $OUTPUT meta mark ${config.mark} return", "")
        commands += RootCommand("nft add rule inet $table $OUTPUT tcp dport ${config.interceptPort} return", "")
        commands += RootCommand("nft add rule inet $table $OUTPUT udp dport ${config.interceptPort} return", "")

        if (config.selfLoopProtection) {
            commands += RootCommand("nft add rule inet $table $OUTPUT ip daddr 127.0.0.0/8 return", "")
            commands += RootCommand("nft add rule inet $table $CHAIN ip daddr 127.0.0.0/8 return", "")
            if (config.ipv6) {
                commands += RootCommand("nft add rule inet $table $OUTPUT ip6 daddr ::1/128 return", "")
                commands += RootCommand("nft add rule inet $table $CHAIN ip6 daddr ::1/128 return", "")
            }
        }

        config.bypassIpv4.distinct().forEach { cidr ->
            commands += RootCommand("nft add rule inet $table $OUTPUT ip daddr $cidr return", "")
            commands += RootCommand("nft add rule inet $table $CHAIN ip daddr $cidr return", "")
        }
        if (config.ipv6) {
            config.bypassIpv6.distinct().forEach { cidr ->
                commands += RootCommand("nft add rule inet $table $OUTPUT ip6 daddr $cidr return", "")
                commands += RootCommand("nft add rule inet $table $CHAIN ip6 daddr $cidr return", "")
            }
        }

        commands += RootCommand(
            "nft add rule inet $table $OUTPUT tcp dport != ${config.interceptPort} meta mark set ${config.mark}",
            "",
        )
        commands += RootCommand(
            "nft add rule inet $table $OUTPUT udp dport != ${config.interceptPort} meta mark set ${config.mark}",
            "",
        )

        if (config.dnsPort != null) {
            commands += RootCommand(
                "nft add rule inet $table $CHAIN udp dport 53 tproxy to :${config.dnsPort} meta mark set ${config.mark} return",
                "",
            )
            commands += RootCommand(
                "nft add rule inet $table $CHAIN tcp dport 53 tproxy to :${config.dnsPort} meta mark set ${config.mark} return",
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
            appliedCommands.clear()
        } catch (error: Throwable) {
            rollbackApplied()
            prepared = false
            throw error
        }
    }

    /**
     * Applies the complete rule set and verifies the resulting kernel state
     * before the transaction becomes committed. Verification failure is a
     * transaction failure and therefore rolls back the applied commands.
     */
    fun commitVerified(verify: () -> Boolean) {
        check(prepared && !committed) { "transaction is not prepared" }
        try {
            for (command in commands) {
                executor.execute(command.apply)
                appliedCommands += command
            }
            check(verify()) { "transparent rule verification failed" }
            committed = true
            appliedCommands.clear()
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
