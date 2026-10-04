package app.angelanexus

class SerializedConfigImportPort(
    private val transport: CoreRuntimeTransport,
) : ConfigImportPort {
    override suspend fun importConfiguration(request: ConfigImportRequest): CoreRuntimeImportResult {
        val payload = ConfigImportEnvelope.serialize(request)
        return transport.sendConfigurationImport(payload)
    }
}
