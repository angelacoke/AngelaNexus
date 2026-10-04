package app.angelanexus

interface CoreRuntimeTransport {
    suspend fun sendConfigurationImport(payload: String): CoreRuntimeImportResult
}


class NativeCoreRuntimeTransport(
    context: android.content.Context,
    private val nativeRuntime: MihomoNativeHost = MihomoNativeRuntimeFactory.create(context),
) : CoreRuntimeTransport {
    private val homeDir = java.io.File(context.filesDir, "angelanexus/core").apply { mkdirs() }

    init {
        nativeRuntime.initialize(homeDir.absolutePath)
    }

    override suspend fun sendConfigurationImport(payload: String): CoreRuntimeImportResult {
        val content = extractContent(payload)
        val error = nativeRuntime.applyConfig(content)
        if (!error.isNullOrEmpty()) {
            throw IllegalStateException("Mihomo rejected configuration: $error")
        }
        return CoreRuntimeImportResult(
            source = "local-file",
            nodeCount = -1,
            kernel = "mihomo",
            detectionConfidence = "native-runtime-verified",
        )
    }

    private fun extractContent(payload: String): String {
        val marker = "\"content\":\""
        val start = payload.indexOf(marker)
        require(start >= 0) { "runtime import envelope is missing content" }
        val valueStart = start + marker.length
        var escaped = false
        for (index in valueStart until payload.length) {
            val char = payload[index]
            if (escaped) { escaped = false; continue }
            if (char == '\\\\') { escaped = true; continue }
            if (char == '\"') {
                return payload.substring(valueStart, index).unescapeJsonString()
            }
        }
        error("runtime import envelope has an unterminated content string")
    }

    private fun String.unescapeJsonString(): String =
        replace("\\\\\\\\", "\\\\")
            .replace("\\\\\"", "\"")
            .replace("\\\\n", "\n")
            .replace("\\\\r", "\r")
            .replace("\\\\t", "\t")
}
