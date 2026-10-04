package app.angelanexus

interface ConfigImportPort {
    suspend fun importConfiguration(request: ConfigImportRequest): CoreRuntimeImportResult
}
