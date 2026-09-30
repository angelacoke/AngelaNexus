package app.angelanexus

/** Verifies the live Android/Linux networking state after transparent rules are applied. */
interface RootTransparentStateInspector {
    fun tableExists(tableName: String): Boolean
    fun ipv4PolicyRuleExists(mark: Int, routingTable: Int): Boolean
    fun ipv4LocalRouteExists(routingTable: Int): Boolean
    fun ipv6PolicyRuleExists(mark: Int, routingTable: Int): Boolean
    fun ipv6LocalRouteExists(routingTable: Int): Boolean
    fun interceptRulesExist(tableName: String, interceptPort: Int): Boolean
    fun dnsRulesExist(tableName: String, dnsPort: Int?): Boolean
    fun selfLoopProtectionExists(tableName: String, ipv6: Boolean): Boolean
}

data class RootTransparentVerification(
    val table: Boolean,
    val ipv4PolicyRule: Boolean,
    val ipv4LocalRoute: Boolean,
    val ipv6PolicyRule: Boolean,
    val ipv6LocalRoute: Boolean,
    val interceptRules: Boolean,
    val dnsRules: Boolean,
    val selfLoopProtection: Boolean,
) {
    val success: Boolean
        get() = table && ipv4PolicyRule && ipv4LocalRoute &&
            ipv6PolicyRule && ipv6LocalRoute && interceptRules &&
            dnsRules && selfLoopProtection
}

class AndroidRootTransparentRuntime(
    private val inspector: RootTransparentStateInspector,
) {
    enum class State { IDLE, APPLYING, ACTIVE, FAILED }

    var state: State = State.IDLE
        private set

    var lastVerification: RootTransparentVerification? = null
        private set

    fun activate(config: RootTransparentConfig, transaction: RootTransparentRuleTransaction) {
        check(state == State.IDLE) { "transparent runtime is not idle" }
        state = State.APPLYING
        try {
            transaction.prepare()
            transaction.commitVerified {
                verify(config).also { lastVerification = it }.success
            }
            state = State.ACTIVE
        } catch (error: Throwable) {
            state = State.FAILED
            throw error
        }
    }

    fun verify(config: RootTransparentConfig): RootTransparentVerification {
        return RootTransparentVerification(
            table = inspector.tableExists(config.tableName),
            ipv4PolicyRule = inspector.ipv4PolicyRuleExists(config.mark, config.routingTable),
            ipv4LocalRoute = inspector.ipv4LocalRouteExists(config.routingTable),
            ipv6PolicyRule = !config.ipv6 || inspector.ipv6PolicyRuleExists(config.mark, config.routingTable),
            ipv6LocalRoute = !config.ipv6 || inspector.ipv6LocalRouteExists(config.routingTable),
            interceptRules = inspector.interceptRulesExist(config.tableName, config.interceptPort),
            dnsRules = inspector.dnsRulesExist(config.tableName, config.dnsPort),
            selfLoopProtection = !config.selfLoopProtection ||
                inspector.selfLoopProtectionExists(config.tableName, config.ipv6),
        )
    }

    fun reset() {
        check(state != State.APPLYING) { "cannot reset while applying transparent rules" }
        state = State.IDLE
        lastVerification = null
    }
}
