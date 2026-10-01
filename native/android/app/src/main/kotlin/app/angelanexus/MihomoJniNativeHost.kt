package app.angelanexus

class MihomoJniNativeHost(
    private val loader: MihomoNativeLibraryLoader,
    private val loadJniLibrary: (String) -> Unit = System::loadLibrary,
) : MihomoNativeHost {
    private var loaded = false

    private fun ensureLoaded() {
        if (!loaded) {
            loader.load().getOrThrow()
            loadJniLibrary("mihomo-jni")
            loaded = true
        }
    }

    override fun startTun(tunFd: Int, stack: String, address: String, dns: String): Boolean {
        require(tunFd >= 0) { "tunFd must be non-negative" }
        ensureLoaded()
        return nativeStartTun(tunFd, stack, address, dns)
    }

    override fun stopTun() {
        if (!loaded) return
        nativeStopTun()
    }

    override fun updateDns(dns: String) {
        ensureLoaded()
        nativeUpdateDns(dns)
    }

    override fun setSuspended(suspended: Boolean) {
        ensureLoaded()
        nativeSetSuspended(suspended)
    }

    override fun invokeMethod(data: String, callback: (String?) -> Unit) {
        ensureLoaded()
        callback(nativeInvokeMethod(data))
    }

    override fun setEventListener(callback: ((String?) -> Unit)?) {
        ensureLoaded()
        nativeSetEventListener(callback)
    }

    override fun forceGc() {
        ensureLoaded()
        nativeForceGc()
    }

    override fun getTraffic(onlyStatisticsProxy: Boolean): String {
        ensureLoaded()
        return nativeGetTraffic(onlyStatisticsProxy)
    }

    override fun getTotalTraffic(onlyStatisticsProxy: Boolean): String {
        ensureLoaded()
        return nativeGetTotalTraffic(onlyStatisticsProxy)
    }

    private external fun nativeStartTun(tunFd: Int, stack: String, address: String, dns: String): Boolean
    private external fun nativeStopTun()
    private external fun nativeUpdateDns(dns: String)
    private external fun nativeSetSuspended(suspended: Boolean)
    private external fun nativeInvokeMethod(data: String): String?
    private external fun nativeSetEventListener(callback: ((String?) -> Unit)?)
    private external fun nativeForceGc()
    private external fun nativeGetTraffic(onlyStatisticsProxy: Boolean): String
    private external fun nativeGetTotalTraffic(onlyStatisticsProxy: Boolean): String
}
