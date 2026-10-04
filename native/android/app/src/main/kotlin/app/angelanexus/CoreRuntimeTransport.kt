package app.angelanexus

interface CoreRuntimeTransport {
    suspend fun sendConfigurationImport(payload: String): CoreRuntimeImportResult
}
