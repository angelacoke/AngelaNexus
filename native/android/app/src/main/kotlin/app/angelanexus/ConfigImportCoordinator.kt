package app.angelanexus

import java.io.InputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

fun interface SubscriptionContentReader {
    fun read(url: String): String
}

class ConfigImportCoordinator(
    private val port: ConfigImportPort,
    private val subscriptionContentReader: SubscriptionContentReader = AndroidSubscriptionUrlReader(),
) {
    suspend fun importLocalFile(
        inputStream: InputStream,
        name: String?,
        trafficAcceptance: ConfigImportRequest.TrafficAcceptancePolicy? = null,
    ): CoreRuntimeImportResult {
        val content = ConfigImportReader.readUtf8(inputStream)
        return submit(ConfigImportRequest.Source.LOCAL_FILE, name, content, trafficAcceptance)
    }

    suspend fun importSubscriptionUrl(
        url: String,
        trafficAcceptance: ConfigImportRequest.TrafficAcceptancePolicy? = null,
    ): CoreRuntimeImportResult {
        val content = withContext(Dispatchers.IO) {
            subscriptionContentReader.read(url)
        }
        return submit(ConfigImportRequest.Source.SUBSCRIPTION_URL, null, content, trafficAcceptance)
    }

    suspend fun importText(
        content: String,
        trafficAcceptance: ConfigImportRequest.TrafficAcceptancePolicy? = null,
    ): CoreRuntimeImportResult = submit(ConfigImportRequest.Source.TEXT, null, content, trafficAcceptance)

    private suspend fun submit(
        source: ConfigImportRequest.Source,
        name: String?,
        content: String,
        trafficAcceptance: ConfigImportRequest.TrafficAcceptancePolicy?,
    ): CoreRuntimeImportResult {
        require(content.length <= MAX_CONTENT_BYTES &&
            content.toByteArray(Charsets.UTF_8).size <= MAX_CONTENT_BYTES
        ) { "configuration exceeds the $MAX_CONTENT_BYTES byte limit" }
        val request = ConfigImportRequest(
            version = ConfigImportRequest.VERSION,
            source = source,
            name = name,
            content = content,
            trafficAcceptance = trafficAcceptance,
        )
        return port.importConfiguration(request)
    }

    companion object {
        const val MAX_CONTENT_BYTES = ConfigImportReader.DEFAULT_MAX_BYTES
    }
}
