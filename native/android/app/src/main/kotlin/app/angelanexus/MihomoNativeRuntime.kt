package app.angelanexus

/**
 * JNI-facing Mihomo runtime boundary.
 *
 * The native library is deliberately not loaded until the repository contains
 * a verified Mihomo Android artifact. This prevents a buildable placeholder
 * from being mistaken for a functioning kernel integration.
 */
class MihomoNativeRuntime(
    private val backend: MihomoNativeHost,
) : MihomoNativeHost by backend
