package app.angelanexus

/**
 * Boundary between the Android platform and the canonical AngelaNexus Core.
 *
 * Implementations must execute the canonical Core import pipeline and return
 * the Core-produced result. They must never apply imported configuration
 * directly to a kernel or synthesize a routing execution intent.
 */
interface CoreRuntimeBridge {
    fun availability(): CoreRuntimeAvailability

    suspend fun importConfiguration(payload: String): CoreRuntimeImportResult
}

enum class CoreRuntimeAvailability {
    AVAILABLE,
    UNAVAILABLE,
}

/**
 * Explicit fail-closed bridge used until a real embedded Core runtime
 * implementation is installed.
 */
class UnavailableCoreRuntimeBridge(
    private val reason: String = DEFAULT_REASON,
) : CoreRuntimeBridge {
    override fun availability(): CoreRuntimeAvailability =
        CoreRuntimeAvailability.UNAVAILABLE

    override suspend fun importConfiguration(payload: String): CoreRuntimeImportResult {
        require(payload.isNotEmpty()) { "configuration import payload must not be empty" }
        throw CoreRuntimeUnavailableException(reason)
    }

    companion object {
        const val DEFAULT_REASON =
            "Android embedded Core runtime is unavailable"
    }
}
