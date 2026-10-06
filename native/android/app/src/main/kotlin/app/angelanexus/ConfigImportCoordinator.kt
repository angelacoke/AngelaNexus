package app.angelanexus

import java.io.InputStream
import java.net.URI

class ConfigImportCoordinator(
    private val port: ConfigImportPort,
) {
    suspend fun importLocalFile(inputStream: InputStream, name: String?): CoreRuntimeImportResult {
        val content = ConfigImportReader.readUtf8(inputStream)
        return import(
            source = ConfigImportRequest.Source.LOCAL_FILE,
            name = name,
            content = content,
        )
    }

    /**
     * Sends user-provided text to Core without attempting to classify it on Android.
     * Core remains authoritative for YAML/JSON/share-link/protocol detection.
     */
    suspend fun importText(text: String, name: String? = null): CoreRuntimeImportResult =
        import(
            source = ConfigImportRequest.Source.TEXT,
            name = name,
            content = requirePayload(text, "text"),
        )

    /**
     * Subscription URLs are passed as data to Core. Android does not fetch the URL
     * itself, preventing a second parser/fetch policy from diverging from Core.
     */
    suspend fun importSubscriptionUrl(
        url: String,
        name: String? = null,
    ): CoreRuntimeImportResult {
        val normalized = requireSubscriptionUrl(url)
        return import(
            source = ConfigImportRequest.Source.SUBSCRIPTION_URL,
            name = name,
            content = normalized,
        )
    }

    suspend fun importStructured(
        serialized: String,
        name: String? = null,
    ): CoreRuntimeImportResult =
        import(
            source = ConfigImportRequest.Source.STRUCTURED,
            name = name,
            content = requirePayload(serialized, "structured configuration"),
        )

    private suspend fun import(
        source: ConfigImportRequest.Source,
        name: String?,
        content: String,
    ): CoreRuntimeImportResult =
        port.importConfiguration(
            ConfigImportRequest(
                version = ConfigImportRequest.VERSION,
                source = source,
                name = name,
                content = content,
            ),
        )

    private fun requirePayload(value: String, label: String): String =
        value.trim().also {
            require(it.isNotEmpty()) { "$label payload must not be empty" }
        }

    private fun requireSubscriptionUrl(value: String): String {
        val normalized = requirePayload(value, "subscription URL")
        val uri = runCatching { URI(normalized) }
            .getOrElse { throw IllegalArgumentException("subscription URL is invalid") }
        require(uri.scheme.equals("https", ignoreCase = true) ||
            uri.scheme.equals("http", ignoreCase = true)) {
            "subscription URL must use HTTP or HTTPS"
        }
        require(!uri.userInfo.isNullOrEmpty().not()) {
            "subscription URL must not contain embedded credentials"
        }
        require(!uri.host.isNullOrBlank()) {
            "subscription URL must contain a host"
        }
        return normalized
    }
}
