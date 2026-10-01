package app.angelanexus

/**
 * Android-side contract for the Mihomo native runtime.
 *
 * The contract follows the proven FlClash shape: Android owns the VpnService
 * file descriptor and platform callbacks; Mihomo owns proxy/TUN processing.
 *
 * This interface intentionally contains no Mihomo configuration parsing.
 * Configuration inspection and kernel selection remain in AngelaNexus Core.
 *
 * A concrete JNI implementation is only considered active after a verified
 * Mihomo native artifact is linked and exercised by the Android build.
 */
interface MihomoNativeHost {
    /** Applies an already-normalized Mihomo configuration document. */
    fun applyConfig(configJson: String): String?

    /**
     * Starts Mihomo against an already-established Android TUN descriptor.
     *
     * @return true only when the native runtime accepted the descriptor.
     */
    fun startTun(
        tunFd: Int,
        stack: String,
        address: String,
        dns: String,
    ): Boolean

    /** Stops the active Mihomo TUN/runtime binding. */
    fun stopTun()

    /** Updates the resolver addresses used by the native runtime. */
    fun updateDns(dns: String)

    /** Suspends or resumes native runtime processing without changing config. */
    fun setSuspended(suspended: Boolean)

    /** Sends a versioned runtime method request to Mihomo. */
    fun invokeMethod(data: String, callback: (String?) -> Unit)

    /** Installs or clears the native runtime event listener. */
    fun setEventListener(callback: ((String?) -> Unit)?)

    /** Requests native garbage collection when supported by the runtime. */
    fun forceGc()

    /** Returns runtime traffic statistics as a native JSON payload. */
    fun getTraffic(onlyStatisticsProxy: Boolean): String

    /** Returns total runtime traffic statistics as a native JSON payload. */
    fun getTotalTraffic(onlyStatisticsProxy: Boolean): String
}
