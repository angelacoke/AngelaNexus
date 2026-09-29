package app.angelanexus

import java.io.InputStream

/**
 * Android-side coordinator for configuration import.
 *
 * It performs only Android transport work: bounded UTF-8 reading and construction of
 * the versioned import envelope. Format detection and kernel binding remain outside
 * Android and are delegated through ConfigImportPort.
 */
class ConfigImportCoordinator(
    private val port: ConfigImportPort,
) {
    suspend fun importLocalFile(inputStream: InputStream, name: String?) {
        val content = ConfigImportReader.readUtf8(inputStream)
        val request = ConfigImportRequest(
            version = ConfigImportRequest.VERSION,
            source = ConfigImportRequest.Source.LOCAL_FILE,
            name = name,
            content = content,
        )
        port.importConfiguration(request)
    }
}
