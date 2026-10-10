package app.angelanexus

import java.io.InputStream
import java.nio.charset.StandardCharsets

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

    suspend fun importText(
        content: String,
        name: String?,
        trafficAcceptance: ConfigImportRequest.TrafficAcceptancePolicy? = null,
    ): CoreRuntimeImportResult {
        require(content.isNotBlank()) { "configuration text must be non-empty" }
        val encoded = content.toByteArray(StandardCharsets.UTF_8)
        try {
            require(encoded.size <= ConfigImportReader.DEFAULT_MAX_BYTES) {
                "configuration exceeds ${ConfigImportReader.DEFAULT_MAX_BYTES} bytes"
            }
        } finally {
            encoded.fill(0)
        }

        val request = ConfigImportRequest(
            version = ConfigImportRequest.VERSION,
            source = ConfigImportRequest.Source.TEXT,
            name = name,
            content = content,
            trafficAcceptance = trafficAcceptance,
        )
        return port.importConfiguration(request)
    }
}
