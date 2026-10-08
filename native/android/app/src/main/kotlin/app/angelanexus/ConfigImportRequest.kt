package app.angelanexus

/**
 * Version-1 Android representation of the platform-neutral configuration import envelope.
 *
 * This DTO is transport-only: it does not parse or select a kernel. The core import
 * pipeline remains the authority for format detection and kernel binding.
 */
data class ConfigImportRequest(
    val version: Int,
    val source: Source,
    val name: String?,
    val content: String,
    val trafficAcceptance: TrafficAcceptancePolicy? = null,
) {
    enum class Source {
        LOCAL_FILE,
        SUBSCRIPTION_URL,
        TEXT,
        STRUCTURED,
    }

    data class TrafficAcceptancePolicy(
        val required: Boolean = true,
        val targetUrl: String,
        val timeoutMs: Int = 5000,
    ) {
        init {
            require(targetUrl.trim().startsWith("https://", ignoreCase = true)) {
                "traffic acceptance target must use HTTPS"
            }
            require(timeoutMs in 1..MAX_TRAFFIC_ACCEPTANCE_TIMEOUT_MS) {
                "traffic acceptance timeoutMs must be an integer between 1 and $MAX_TRAFFIC_ACCEPTANCE_TIMEOUT_MS"
            }
        }
    }

    init {
        require(version == VERSION) { "unsupported configuration import version: $version" }
        require(content.isNotEmpty()) { "configuration import payload must be non-empty" }
        require(name == null || name.length <= MAX_NAME_LENGTH) {
            "configuration import name is invalid"
        }
    }

    companion object {
        const val VERSION = 1
        const val MAX_NAME_LENGTH = 255
        const val MAX_TRAFFIC_ACCEPTANCE_TIMEOUT_MS = 30000
    }
}
