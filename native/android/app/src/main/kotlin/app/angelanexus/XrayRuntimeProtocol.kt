package app.angelanexus

object XrayRuntimeProtocol {
    const val ACTION_START = "app.angelanexus.xray.START"
    const val ACTION_STOP = "app.angelanexus.xray.STOP"
    const val EXTRA_CONFIG = "app.angelanexus.xray.CONFIG"
    const val EXTRA_TUN = "app.angelanexus.xray.TUN"
    const val EXTRA_DNS = "app.angelanexus.xray.DNS"
    const val EXTRA_PROTECTOR = "app.angelanexus.xray.PROTECTOR"
    const val EXTRA_RESULT = "app.angelanexus.xray.RESULT"
    const val RESULT_OK = 1
    const val RESULT_FAILED = 2
    const val RESULT_ERROR = "error"
}
