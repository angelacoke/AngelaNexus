package app.angelanexus

import android.os.Binder
import android.os.Parcel

interface XrayVpnProtector {
    fun protect(fd: Int): Boolean
}

class XrayVpnProtectorBinder(
    private val protector: XrayVpnProtector,
) : Binder() {
    companion object {
        const val TRANSACTION_PROTECT = FIRST_CALL_TRANSACTION + 1
    }

    override fun onTransact(code: Int, data: Parcel, reply: Parcel, flags: Int): Boolean {
        if (code == TRANSACTION_PROTECT) {
            data.enforceInterface(descriptor)
            val fd = data.readInt()
            reply.writeNoException()
            reply.writeInt(if (protector.protect(fd)) 1 else 0)
            return true
        }
        return super.onTransact(code, data, reply, flags)
    }

    fun protect(fd: Int): Boolean = protector.protect(fd)
}
