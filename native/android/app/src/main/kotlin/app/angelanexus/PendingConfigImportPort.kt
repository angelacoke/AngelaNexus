package app.angelanexus

/**
 * Temporary in-process boundary for the Android configuration import flow.
 *
 * This port deliberately does not parse configuration or select a kernel. Until a
 * real Core runtime transport is present, requests are retained only as the latest
 * bounded handoff and can be inspected by the Android layer. No configuration is
 * claimed to be imported into a kernel.
 */
class PendingConfigImportPort : ConfigImportPort {
    @Volatile
    private var latestRequest: ConfigImportRequest? = null

    override suspend fun importConfiguration(request: ConfigImportRequest) {
        latestRequest = request
    }

    fun latestRequest(): ConfigImportRequest? = latestRequest
}
