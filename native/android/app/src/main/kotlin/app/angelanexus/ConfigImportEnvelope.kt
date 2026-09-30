package app.angelanexus

import org.json.JSONObject
import java.nio.charset.StandardCharsets

/**
 * Android serialization of the platform-neutral runtime import envelope.
 *
 * The envelope shape mirrors src/platform/runtime-import.js. Android does not
 * interpret the configuration body; it only serializes the bounded transport DTO.
 */
object ConfigImportEnvelope {
    const val TYPE = "angelanexus.config-import"
    const val MAX_PAYLOAD_BYTES = 5 * 1024 * 1024

    fun serialize(
        request: ConfigImportRequest,
        maxBytes: Int = MAX_PAYLOAD_BYTES,
    ): String {
        require(maxBytes > 0) { "runtime import maxBytes must be positive" }

        val payload = JSONObject()
            .put("type", TYPE)
            .put("version", request.version)
            .put("source", request.source.wireValue)
            .put("name", request.name)
            .put("content", request.content)
            .toString()

        val size = payload.toByteArray(StandardCharsets.UTF_8).size
        require(size <= maxBytes) {
            "runtime import payload exceeds byte limit: $size > $maxBytes"
        }
        return payload
    }

    private val ConfigImportRequest.Source.wireValue: String
        get() = when (this) {
            ConfigImportRequest.Source.LOCAL_FILE -> "local-file"
            ConfigImportRequest.Source.SUBSCRIPTION_URL -> "subscription-url"
            ConfigImportRequest.Source.TEXT -> "text"
            ConfigImportRequest.Source.STRUCTURED -> "structured"
        }
}
