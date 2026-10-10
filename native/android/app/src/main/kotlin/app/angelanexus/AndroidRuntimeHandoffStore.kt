package app.angelanexus

import java.util.UUID

/**
 * One-shot, process-local handoff from the foreground UI to the VPN service.
 *
 * The configuration can be several MiB, so it must not be serialized through a
 * Service Intent or persisted as a plaintext cache file. Only the opaque token
 * crosses the Android system-server boundary. If the process loses the handoff,
 * the service fails closed and asks the user to import again.
 */
internal object AndroidRuntimeHandoffStore {
    private data class Entry(
        val token: String,
        val result: CoreRuntimeImportResult,
    )

    private var pending: Entry? = null

    @Synchronized
    fun publish(result: CoreRuntimeImportResult): String {
        require(result.hasExecutableAndroidExecutionHandoff()) {
            "an executable Android proxy handoff is required before starting runtime"
        }
        val token = UUID.randomUUID().toString()
        pending = Entry(token, result)
        return token
    }

    @Synchronized
    fun consume(token: String?): CoreRuntimeImportResult? {
        val entry = pending ?: return null
        if (token.isNullOrBlank() || token != entry.token) return null
        pending = null
        return entry.result
    }

    @Synchronized
    fun discard(token: String) {
        if (pending?.token == token) pending = null
    }
}
