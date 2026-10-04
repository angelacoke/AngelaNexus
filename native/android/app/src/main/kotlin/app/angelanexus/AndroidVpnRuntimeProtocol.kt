package app.angelanexus

object AndroidVpnRuntimeProtocol {
    const val ACTION_START = "app.angelanexus.vpn.START"
    const val ACTION_STOP = "app.angelanexus.vpn.STOP"

    const val EXTRA_KERNEL_ID = "app.angelanexus.vpn.KERNEL_ID"
    const val EXTRA_EXECUTION_MODE = "app.angelanexus.vpn.EXECUTION_MODE"
    const val EXTRA_TARGET = "app.angelanexus.vpn.TARGET"
    const val EXTRA_SESSION = "app.angelanexus.vpn.SESSION"
    const val EXTRA_IPV4_ADDRESS = "app.angelanexus.vpn.IPV4_ADDRESS"
    const val EXTRA_IPV4_PREFIX = "app.angelanexus.vpn.IPV4_PREFIX"
    const val EXTRA_IPV6_ADDRESS = "app.angelanexus.vpn.IPV6_ADDRESS"
    const val EXTRA_IPV6_PREFIX = "app.angelanexus.vpn.IPV6_PREFIX"
    const val EXTRA_ROUTES = "app.angelanexus.vpn.ROUTES"
    const val EXTRA_DNS_SERVERS = "app.angelanexus.vpn.DNS_SERVERS"
    const val EXTRA_BLOCKING = "app.angelanexus.vpn.BLOCKING"
    const val EXTRA_RESULT = "app.angelanexus.vpn.RESULT"

    const val RESULT_OK = 1
    const val RESULT_FAILED = 2
    const val RESULT_ERROR = "error"

    const val MODE_PROXY = "proxy"
    const val MODE_DIRECT = "direct"
    const val MODE_REJECT = "reject"
    const val MODE_CHAIN = "chain"
    const val MODE_DNS = "dns"
}
