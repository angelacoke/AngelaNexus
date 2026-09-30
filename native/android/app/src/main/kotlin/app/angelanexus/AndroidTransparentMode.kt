package app.angelanexus

enum class AndroidTransparentMode(val wireValue: String) {
    AUTO("auto"),
    SYSTEM("system"),
    ROOT("root"),
}

fun selectAndroidTransparentMode(
    requested: AndroidTransparentMode,
    capabilities: AndroidRootTransparentAdapter.Capabilities,
): AndroidTransparentMode? {
    return when (requested) {
        AndroidTransparentMode.ROOT ->
            if (capabilities.rootBackendReady) AndroidTransparentMode.ROOT else null
        AndroidTransparentMode.SYSTEM ->
            if (capabilities.systemVpnAvailable) AndroidTransparentMode.SYSTEM else null
        AndroidTransparentMode.AUTO -> when {
            capabilities.rootBackendReady -> AndroidTransparentMode.ROOT
            capabilities.systemVpnAvailable -> AndroidTransparentMode.SYSTEM
            else -> null
        }
    }
}
