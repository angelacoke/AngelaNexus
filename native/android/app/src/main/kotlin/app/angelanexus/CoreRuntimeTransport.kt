package app.angelanexus

interface CoreRuntimeTransport {
    suspend fun sendConfigurationImport(payload: String): CoreRuntimeImportResult
}

/**
 * Android-local Core transport placeholder.
 *
 * The Android platform must not bypass the canonical Core by applying imported
 * configuration directly to a kernel. Until an embedded Core runtime bridge is
 * actually available, this transport fails closed.
 */
class NativeCoreRuntimeTransport(
    private val unavailableReason: String = DEFAULT_UNAVAILABLE_REASON,
) : CoreRuntimeTransport {
    override suspend fun sendConfigurationImport(payload: String): CoreRuntimeImportResult {
        require(payload.isNotEmpty()) { "configuration import payload must not be empty" }
        throw CoreRuntimeUnavailableException(unavailableReason)
    }

    companion object {
        const val DEFAULT_UNAVAILABLE_REASON =
            "Android embedded Core runtime is unavailable; configuration was not sent directly to a kernel"
    }
}

class CoreRuntimeUnavailableException(
    message: String,
) : IllegalStateException(message)
