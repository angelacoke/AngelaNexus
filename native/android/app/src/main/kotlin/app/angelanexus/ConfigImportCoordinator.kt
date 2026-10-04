package app.angelanexus

import java.io.InputStream

class ConfigImportCoordinator(
    private val port: ConfigImportPort,
) {
    suspend fun importLocalFile(inputStream: InputStream, name: String?): CoreRuntimeImportResult {
        val content = ConfigImportReader.readUtf8(inputStream)
        val request = ConfigImportRequest(
            version = ConfigImportRequest.VERSION,
            source = ConfigImportRequest.Source.LOCAL_FILE,
            name = name,
            content = content,
        )
        return port.importConfiguration(request)
    }
}
