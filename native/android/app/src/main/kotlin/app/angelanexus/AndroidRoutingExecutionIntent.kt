package app.angelanexus

import org.json.JSONArray
import org.json.JSONObject

/**
 * Android adapter for the canonical Core routing-execution-intent JSON contract.
 *
 * This type is not a second routing engine: it only validates and carries the
 * intent already produced by Core across the Android process boundary.
 */
data class AndroidRoutingExecutionIntent(
    val version: Int,
    val mode: String,
    val action: String,
    val target: String?,
    val hopsJson: String?,
    val ruleIds: List<String>,
    val applicationJson: String?,
    val metadataJson: String?,
    val trafficAcceptance: AndroidTrafficAcceptanceSpec?,
    val serialized: String,
) {
    companion object {
        private const val VERSION = 1
        private val MODES = setOf("proxy", "direct", "reject", "chain", "dns")
        private val ACTIONS = setOf("route", "bypass", "reject", "chain", "dns")

        fun parse(serialized: String): AndroidRoutingExecutionIntent {
            require(serialized.isNotBlank()) { "routing execution intent is empty" }

            val root = JSONObject(serialized)
            val version = root.optInt("version", -1)
            require(version == VERSION) {
                "unsupported routing execution intent version: $version"
            }
            require(root.optString("kind") == "routing-execution-intent") {
                "invalid routing execution intent kind"
            }

            val mode = root.optString("mode").trim()
            require(mode in MODES) { "unsupported routing execution intent mode: $mode" }

            val action = root.optString("action").trim()
            require(action in ACTIONS) { "unsupported routing execution intent action: $action" }
            val expectedAction = when (mode) {
                "proxy" -> "route"
                "direct" -> "bypass"
                "reject" -> "reject"
                "chain" -> "chain"
                "dns" -> "dns"
                else -> error("unsupported routing execution intent mode: $mode")
            }
            require(action == expectedAction) {
                "routing execution intent action '$action' does not match mode '$mode'"
            }

            val target = root.optString("target", "").trim().ifEmpty { null }
            if (mode == "proxy" || mode == "direct" || mode == "dns") {
                require(!target.isNullOrEmpty()) {
                    "routing execution intent requires a target for $action"
                }
            }

            val hops = if (mode == "chain") {
                val array = root.optJSONArray("hops")
                    ?: throw IllegalArgumentException("routing execution intent chain requires hops")
                require(array.length() >= 2) {
                    "routing execution intent chain requires at least two hops"
                }
                for (index in 0 until array.length()) {
                    val hop = array.get(index)
                    if (hop is String) {
                        require(hop.trim().isNotEmpty()) {
                            "routing execution intent hop $index requires a node reference"
                        }
                    } else if (hop is JSONObject) {
                        val node = hop.optString("node").trim()
                            .ifEmpty { hop.optString("id").trim() }
                            .ifEmpty { hop.optString("target").trim() }
                        require(node.isNotEmpty()) {
                            "routing execution intent hop $index requires a node reference"
                        }
                    } else {
                        throw IllegalArgumentException(
                            "routing execution intent hop $index is invalid",
                        )
                    }
                }
                array.toString()
            } else {
                null
            }

            val ruleIds = root.optJSONArray("ruleIds")?.let { array ->
                buildList {
                    for (index in 0 until array.length()) {
                        val value = array.optString(index).trim()
                        if (value.isNotEmpty()) add(value)
                    }
                }
            } ?: emptyList()

            val applicationJson = root.optJSONObject("application")?.toString()
            val metadataObject = root.optJSONObject("metadata")
            val metadataJson = metadataObject?.toString()
            val trafficAcceptance = metadataObject
                ?.optJSONObject("trafficAcceptance")
                ?.let(AndroidTrafficAcceptanceSpec::parse)

            return AndroidRoutingExecutionIntent(
                version = version,
                mode = mode,
                action = action,
                target = target,
                hopsJson = hops,
                ruleIds = ruleIds,
                applicationJson = applicationJson,
                metadataJson = metadataJson,
                trafficAcceptance = trafficAcceptance,
                serialized = root.toString(),
            )
        }
    }
}

data class AndroidTrafficAcceptanceSpec(
    val required: Boolean,
    val targetUrl: String,
    val timeoutMs: Int,
) {
    companion object {
        fun parse(value: JSONObject): AndroidTrafficAcceptanceSpec {
            val targetUrl = value.optString("targetUrl").trim()
            require(targetUrl.isNotEmpty()) { "traffic acceptance targetUrl is required" }
            require(targetUrl.startsWith("https://", ignoreCase = true)) {
                "traffic acceptance targetUrl must use HTTPS"
            }
            val required = if (value.has("required")) value.optBoolean("required") else true
            require(value.opt("required") == null || value.opt("required") is Boolean) {
                "traffic acceptance required must be boolean"
            }
            val timeoutMs = if (value.has("timeoutMs")) value.optInt("timeoutMs", -1) else 5000
            require(timeoutMs in 1..30000) {
                "traffic acceptance timeoutMs must be between 1 and 30000"
            }
            return AndroidTrafficAcceptanceSpec(required, targetUrl, timeoutMs)
        }
    }
}
