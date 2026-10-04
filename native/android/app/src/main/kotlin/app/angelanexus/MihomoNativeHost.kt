package app.angelanexus

interface MihomoNativeHost {
    fun initialize(homeDir: String)
    fun setVpnService(service: android.net.VpnService)
    fun clearVpnService()
    fun hasVpnProtector(): Boolean
    fun applyConfig(configJson: String): String?
    fun startTun(tunFd: Int, stack: String, address: String, dns: String): Boolean
    fun stopTun()
    fun updateDns(dns: String)
    fun setSuspended(suspended: Boolean)
    fun invokeMethod(data: String, callback: (String?) -> Unit)
    fun setEventListener(callback: ((String?) -> Unit)?)
    fun forceGc()
    fun getTraffic(onlyStatisticsProxy: Boolean): String
    fun getTotalTraffic(onlyStatisticsProxy: Boolean): String
}