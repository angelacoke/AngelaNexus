package app.angelanexus

/**
 * Native-to-application boundary for configuration import.
 *
 * Implementations are responsible for transporting the already-bounded envelope to
 * the application/core layer. They must not reinterpret protocol syntax or select a
 * kernel on the Android side.
 */
interface ConfigImportPort {
    suspend fun importConfiguration(request: ConfigImportRequest)
}
