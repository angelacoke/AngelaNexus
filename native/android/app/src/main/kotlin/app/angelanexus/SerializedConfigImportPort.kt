package app.angelanexus

/**
 * Bridges the Android import DTO to a real Core runtime transport.
 *
 * No runtime implementation is assumed here. The injected transport is the only
 * component allowed to deliver the serialized envelope outside the Android shell.
 */
class SerializedConfigImportPort(
    private val transport: CoreRuntimeTransport,
) : ConfigImportPort {
    override suspend fun importConfiguration(request: ConfigImportRequest) {
        val payload = ConfigImportEnvelope.serialize(request)
        transport.sendConfigurationImport(payload)
    }
}
