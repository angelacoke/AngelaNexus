package app.angelanexus

import android.os.Binder

interface XrayVpnProtector {
    fun protect(fd: Int): Boolean
}

class XrayVpnProtectorBinder(
    private val protector: XrayVpnProtector,
) : Binder() {
    fun protect(fd: Int): Boolean = protector.protect(fd)
}
