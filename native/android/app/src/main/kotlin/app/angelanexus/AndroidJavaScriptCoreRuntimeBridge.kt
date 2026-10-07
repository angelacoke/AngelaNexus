package app.angelanexus

import android.content.Context
import androidx.javascriptengine.JavaScriptIsolate
import androidx.javascriptengine.JavaScriptSandbox
import java.util.concurrent.TimeUnit
import org.json.JSONObject

/**
 * Executes the canonical AngelaNexus Core import pipeline inside Android's
 * out-of-process JavaScript sandbox.
 *
 * This bridge never parses configuration or selects a kernel in Kotlin.
 * Android only supplies the serialized import envelope and consumes the
 * Core-produced result.
 */
class AndroidJavaScriptCoreRuntimeBridge(
    context: Context,
    private val evaluationTimeoutMs: Long = DEFAULT_EVALUATION_TIMEOUT_MS,
) : CoreRuntimeBridge {
    private val appContext = context.applicationContext

    init {
        require(evaluationTimeoutMs > 0) { "Core evaluation timeout must be positive" }
    }

    override fun availability(): CoreRuntimeAvailability =
        if (isRuntimeSupported(appContext)) {
            CoreRuntimeAvailability.AVAILABLE
        } else {
            CoreRuntimeAvailability.UNAVAILABLE
        }

    override suspend fun importConfiguration(payload: String): CoreRuntimeImportResult {
        require(payload.isNotEmpty()) { "configuration import payload must not be empty" }

        if (availability() != CoreRuntimeAvailability.AVAILABLE) {
            throw CoreRuntimeUnavailableException(DEFAULT_UNAVAILABLE_REASON)
        }

        val runtime = AndroidJavaScriptCoreRuntimeRegistry.runtime(appContext)
        val output = if (runtime.sandbox.isFeatureSupported(
                JavaScriptSandbox.JS_FEATURE_PROVIDE_CONSUME_ARRAY_BUFFER,
            )
        ) {
            val name = "angelanexus-import-" + runtime.sequence.incrementAndGet()
            runtime.isolate.provideNamedData(name, payload.toByteArray(Charsets.UTF_8))
            runtime.isolate.evaluateJavaScriptAsync(
                "globalThis.angelanexusCoreImportNamed(" + JSONObject.quote(name) + ")",
            ).get(evaluationTimeoutMs, TimeUnit.MILLISECONDS)
        } else {
            runtime.isolate.evaluateJavaScriptAsync(
                "globalThis.angelanexusCoreImport(" + JSONObject.quote(payload) + ")",
            ).get(evaluationTimeoutMs, TimeUnit.MILLISECONDS)
        }

        if (output.isBlank()) {
            throw IllegalStateException("Android Core runtime returned an empty result")
        }
        return CoreRuntimeImportResultParser.parse(output)
    }

    companion object {
        const val DEFAULT_EVALUATION_TIMEOUT_MS = 10_000L
        const val DEFAULT_UNAVAILABLE_REASON =
            "Android canonical Core runtime is unavailable; configuration was not sent directly to a kernel"

        private fun isRuntimeSupported(context: Context): Boolean {
            if (!JavaScriptSandbox.isSupported()) return false
            return runCatching {
                context.assets.open(ASSET_NAME).use { true }
            }.getOrDefault(false)
        }

        private const val ASSET_NAME = "angelanexus-core.bundle.js"
    }
}

internal object AndroidJavaScriptCoreRuntimeRegistry {
    data class Runtime(
        val sandbox: JavaScriptSandbox,
        val isolate: JavaScriptIsolate,
        val sequence: java.util.concurrent.atomic.AtomicLong = java.util.concurrent.atomic.AtomicLong(),
    )

    @Volatile
    private var runtime: Runtime? = null

    @Synchronized
    fun runtime(context: Context): Runtime {
        runtime?.let { return it }

        val sandbox = JavaScriptSandbox.createConnectedInstanceAsync(context.applicationContext)
            .get(10, TimeUnit.SECONDS)

        val isolate = sandbox.createIsolate()
        try {
            val bundle = context.assets.open("angelanexus-core.bundle.js").use { it.readBytes() }
            if (bundle.isEmpty()) throw IllegalStateException("Android Core runtime bundle is empty")
            isolate.evaluateJavaScriptAsync(String(bundle, Charsets.UTF_8))
                .get(10, TimeUnit.SECONDS)
            val ready = isolate.evaluateJavaScriptAsync(
                "String(globalThis.angelanexusCoreRuntimeReady === true)",
            ).get(5, TimeUnit.SECONDS)
            check(ready == "true") { "Android Core runtime bundle did not report ready" }
        } catch (error: Throwable) {
            isolate.close()
            sandbox.close()
            throw error
        }

        return Runtime(sandbox, isolate).also { runtime = it }
    }
}
