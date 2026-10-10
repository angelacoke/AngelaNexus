package app.angelanexus

import java.io.InputStream

class ConfigImportCoordinator(
    private val port: ConfigImportPort,
) {
    suspend fun importLocalFile(
        inputStream: InputStream,
        name: String?,
        trafficAcceptance: ConfigImportRequest.TrafficAcceptancePolicy? = null,
    ): CoreRuntimeImportResult {
        val content = ConfigImportReader.readUtf8(inputStream)
        val request = ConfigImportRequest(
            version = ConfigImportRequest.VERSION,
            source = ConfigImportRequest.Source.LOCAL_FILE,
            name = name,
            content = content,
            trafficAcceptance = trafficAcceptance,
        )
        return port.importConfiguration(request)
    }

    suspend fun importSubscriptionContent(
        inputStream: InputStream,
        name: String?,
        trafficAcceptance: ConfigImportRequest.TrafficAcceptancePolicy? = null,
    ): CoreRuntimeImportResult {
        val content = ConfigImportReader.readUtf8(inputStream)
        val request = ConfigImportRequest(
            version = ConfigImportRequest.VERSION,
            source = ConfigImportRequest.Source.SUBSCRIPTION_URL,
            name = name,
            content = content,
            trafficAcceptance = trafficAcceptance,
        )
        return port.importConfiguration(request)
    }
}
