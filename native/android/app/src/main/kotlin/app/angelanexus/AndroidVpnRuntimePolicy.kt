package app.angelanexus

/**
 * Android platform execution policy for the system VPN path.
 *
 * This is platform control-plane data: it establishes the OS interception
 * boundary. It does not parse user configuration or choose a kernel.
 */
data class AndroidVpnRuntimePolicy(
    val stack: String = "system",
    val addresses: List<String> = listOf(
        "198.18.0.2/30",
        "fd00:198:18::2/126",
    ),
    val routes: List<String> = listOf(
        "0.0.0.0/0",
        "::/0",
    ),
    val dnsHijack: String = "198.18.0.2",
    val mtu: Int = 1500,
) {
    init {
        require(stack.isNotBlank())
        require(addresses.isNotEmpty())
        require(routes.isNotEmpty())
        require(mtu >= 1280)
    }

    companion object {
        fun default(): AndroidVpnRuntimePolicy = AndroidVpnRuntimePolicy()
    }
}
