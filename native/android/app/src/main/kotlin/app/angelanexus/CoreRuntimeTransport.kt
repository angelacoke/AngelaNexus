package app.angelanexus

/**
 * Transport boundary from the Android shell to a hosted AngelaNexus Core runtime.
 *
 * The implementation owns only delivery of the already-serialized runtime envelope.
 * It must not parse configuration syntax, select a kernel, or silently fall back to
 * staging when no runtime is available.
 */
interface CoreRuntimeTransport {
    suspend fun sendConfigurationImport(payload: String)
}
