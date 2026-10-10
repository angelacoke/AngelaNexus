package app.angelanexus

/**
 * Result returned by Core after configuration import.
 *
 * executionIntentJson is optional for backward compatibility, but when present
 * it is the canonical Core routing-execution-intent serialized at the platform
 * boundary. Android must validate it and never synthesize or reinterpret it.
 */
data class CoreRuntimeImportResult(
    val source: String?,
    val nodeCount: Int,
    val kernel: String?,
    val detectionConfidence: String?,
    val configuration: String? = null,
    val executionIntentJson: String? = null,
    val nodeSummaries: List<CoreNodeSummary> = emptyList(),
    val nodeSummariesTruncated: Boolean = false,
)

/** Display-only fields projected by Core; authentication and runtime config stay out of this DTO. */
data class CoreNodeSummary(
    val name: String,
    val protocol: String?,
    val server: String?,
    val port: Int?,
)
