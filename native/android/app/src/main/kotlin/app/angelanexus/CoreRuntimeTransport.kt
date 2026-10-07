package app.angelanexus

interface CoreRuntimeTransport {
    suspend fun sendConfigurationImport(payload: String): CoreRuntimeImportResult
}

/**
 * Android transport boundary for the canonical Core runtime.
 *
 * The transport delegates to a CoreRuntimeBridge. It does not parse imported
 * configuration, select a kernel, apply configuration to a kernel, or
 * synthesize execution intent.
 */
class NativeCoreRuntimeTransport(
    private val bridge: CoreRuntimeBridge = UnavailableCoreRuntimeBridge(),
) : CoreRuntimeTransport {
    override suspend fun sendConfigurationImport(payload: String): CoreRuntimeImportResult {
        require(payload.isNotEmpty()) { "configuration import payload must not be empty" }
        if (bridge.availability() != CoreRuntimeAvailability.AVAILABLE) {
            throw CoreRuntimeUnavailableException(
                "Android embedded Core runtime is unavailable; configuration was not sent directly to a kernel",
            )
        }
        return bridge.importConfiguration(payload)
    }
}

class CoreRuntimeUnavailableException(
    message: String,
) : IllegalStateException(message)
