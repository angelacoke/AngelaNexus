package app.angelanexus

/**
 * Platform dispatcher for the canonical Core routing-execution-intent.
 *
 * Core owns policy, intent construction, and kernel selection. Android only
 * validates the intent and maps the already-selected kernel id to a registered
 * driver. It never performs a second kernel selection or fallback.
 */
class AndroidRoutingExecutionDispatcher(
    private val driverResolver: (String) -> AndroidKernelDriver,
) {
    data class Dispatch(
        val mode: String,
        val target: String?,
        val hopsJson: String?,
        val kernelId: String?,
        val driver: AndroidKernelDriver?,
    )

    fun dispatch(
        intent: AndroidRoutingExecutionIntent,
        selectedKernelId: String?,
    ): Dispatch {
        return when (intent.mode) {
            "proxy" -> {
                val kernelId = selectedKernelId?.trim().orEmpty()
                require(kernelId.isNotEmpty()) {
                    "proxy execution intent requires Core-selected kernel identity"
                }
                val driver = driverResolver(kernelId)
                Dispatch(intent.mode, intent.target, intent.hopsJson, kernelId, driver)
            }
            "direct", "reject", "dns", "chain" -> {
                Dispatch(intent.mode, intent.target, intent.hopsJson, null, null)
            }
            else -> error("unsupported routing execution intent mode: " + intent.mode)
        }
    }
}
