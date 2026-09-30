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
    val rootReady = capabilities.rootAvailable && capabilities.rootAuthorized
    return when (requested) {
        AndroidTransparentMode.ROOT -> if (rootReady) AndroidTransparentMode.ROOT else null
        AndroidTransparentMode.SYSTEM -> if (capabilities.systemVpnAvailable) AndroidTransparentMode.SYSTEM else null
        AndroidTransparentMode.AUTO -> when {
            rootReady -> AndroidTransparentMode.ROOT
            capabilities.systemVpnAvailable -> AndroidTransparentMode.SYSTEM
            else -> null
        }
    }
}
