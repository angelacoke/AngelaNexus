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

    /**
     * Positive state checks are the single source of truth for cleanup.
     * A default implementation keeps test/future platform inspectors source-compatible.
     */
    fun isClear(config: RootTransparentConfig): Boolean =
        !tableExists(config.tableName) &&
            !ipv4PolicyRuleExists(config.mark, config.routingTable) &&
            !ipv4LocalRouteExists(config.routingTable) &&
            (!config.ipv6 || !ipv6PolicyRuleExists(config.mark, config.routingTable)) &&
            (!config.ipv6 || !ipv6LocalRouteExists(config.routingTable)) &&
            !interceptRulesExist(config.tableName, config.interceptPort) &&
            (config.dnsPort == null || !dnsRulesExist(config.tableName, config.dnsPort)) &&
            (!config.selfLoopProtection ||
                !selfLoopProtectionExists(config.tableName, config.ipv6))
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
    enum class State { IDLE, APPLYING, ACTIVE, STOPPING, FAILED }

    var state: State = State.IDLE
        private set

    var lastVerification: RootTransparentVerification? = null
        private set

    private var activeConfig: RootTransparentConfig? = null
    private var activeTransaction: RootTransparentRuleTransaction? = null

    fun activate(config: RootTransparentConfig, transaction: RootTransparentRuleTransaction) {
        check(state == State.IDLE) { "transparent runtime is not idle" }
        state = State.APPLYING
        try {
            transaction.prepare()
            transaction.commitVerified {
                verify(config).also { lastVerification = it }.success
            }
            activeConfig = config
            activeTransaction = transaction
            state = State.ACTIVE
        } catch (error: Throwable) {
            if (!inspector.isClear(config)) {
                error.addSuppressed(
                    IllegalStateException("transparent rule rollback could not be verified as clear"),
                )
            }
            state = State.FAILED
            throw error
        }
    }

    /**
     * Removes every rule owned by this runtime and verifies the live kernel state
     * is clear before reporting IDLE. Cleanup failure remains FAILED.
     */
    fun stop() {
        check(state == State.ACTIVE) {
            "transparent runtime is not stoppable in state $state"
        }
        val config = activeConfig ?: error("transparent runtime has no active configuration")
        val transaction = activeTransaction ?: error("transparent runtime has no active transaction")
        state = State.STOPPING
        try {
            check(transaction.rollbackCommitted()) { "transparent rule cleanup command failed" }
            check(inspector.isClear(config)) { "transparent rule cleanup verification failed" }
            activeConfig = null
            activeTransaction = null
            lastVerification = null
            state = State.IDLE
        } catch (error: Throwable) {
            state = State.FAILED
            throw error
        }
    }

    /**
     * Performs a live health check without changing kernel state.
     * A running instance is considered unsafe once any required interception,
     * routing, DNS, or self-loop protection component disappears.
     */
    fun healthCheck(config: RootTransparentConfig): RootTransparentVerification {
        check(state == State.ACTIVE) { "transparent runtime is not active" }
        val verification = verify(config)
        lastVerification = verification
        if (!verification.success) {
            state = State.FAILED
            throw IllegalStateException("transparent runtime health verification failed")
        }
        return verification
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
        check(state != State.APPLYING && state != State.STOPPING) {
            "cannot reset while applying or stopping transparent rules"
        }
        check(state == State.IDLE) { "cannot reset an active or failed transparent runtime" }
        activeConfig = null
        activeTransaction = null
        lastVerification = null
    }
}
