package app.angelanexus

import java.nio.charset.StandardCharsets

/**
 * Android serialization of the platform-neutral runtime import envelope.
 *
 * Android does not interpret the configuration body; it only serializes the
 * bounded transport DTO.
 */
object ConfigImportEnvelope {
    const val TYPE = "angelanexus.config-import"
    const val MAX_PAYLOAD_BYTES = 5 * 1024 * 1024

    fun serialize(
        request: ConfigImportRequest,
        maxBytes: Int = MAX_PAYLOAD_BYTES,
    ): String {
        require(maxBytes > 0) { "runtime import maxBytes must be positive" }

        val payload = buildString {
            append('{')
            append(""type":"").append(escape(TYPE)).append("",")
            append(""version":").append(request.version).append(',')
            append(""source":"").append(escape(request.source.wireValue)).append("",")
            append(""name":")
            if (request.name == null) append("null") else append(""").append(escape(request.name)).append(""")
            append(',')
            append(""content":"").append(escape(request.content)).append(""")
            request.trafficAcceptance?.let { policy ->
                append(',')
                append(""trafficAcceptance":{")
                append(""required":").append(policy.required).append(',')
                append(""targetUrl":"").append(escape(policy.targetUrl.trim())).append("",")
                append(""timeoutMs":").append(policy.timeoutMs)
                append('}')
            }
            append('}')
        }

        val size = payload.toByteArray(StandardCharsets.UTF_8).size
        require(size <= maxBytes) {
            "runtime import payload exceeds byte limit: $size > $maxBytes"
        }
        return payload
    }

    private fun escape(value: String): String = buildString(value.length) {
        for (char in value) {
            when (char) {
                '\\' -> append("\\\\")
                '"' -> append("\\"")
                '\b' -> append("\\b")
                '\u000C' -> append("\\f")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> {
                    if (char.code < 0x20) {
                        append("\\u").append(char.code.toString(16).padStart(4, '0'))
                    } else {
                        append(char)
                    }
                }
            }
        }
    }

    private val ConfigImportRequest.Source.wireValue: String
        get() = when (this) {
            ConfigImportRequest.Source.LOCAL_FILE -> "local-file"
            ConfigImportRequest.Source.SUBSCRIPTION_URL -> "subscription-url"
            ConfigImportRequest.Source.TEXT -> "text"
            ConfigImportRequest.Source.STRUCTURED -> "structured"
        }
}
