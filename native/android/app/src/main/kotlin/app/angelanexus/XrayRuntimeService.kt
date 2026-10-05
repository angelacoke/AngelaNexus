package app.angelanexus

import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.Parcel
import android.os.ParcelFileDescriptor
import android.os.ResultReceiver
import org.json.JSONArray
import org.json.JSONObject
import java.lang.reflect.InvocationHandler
import java.lang.reflect.Method
import java.lang.reflect.Proxy

/**
 * Isolated Xray process. libXray and Mihomo must never share one process.
 */
class XrayRuntimeService : Service() {
    private var tun: ParcelFileDescriptor? = null
    private var running = false

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            XrayRuntimeProtocol.ACTION_START -> handleStart(intent)
            XrayRuntimeProtocol.ACTION_STOP -> handleStop(intent)
        }
        return START_NOT_STICKY
    }

    private fun handleStart(intent: Intent) {
        val receiver = intent.parcelable<ResultReceiver>(XrayRuntimeProtocol.EXTRA_RESULT)
        runCatching {
            check(stopRuntime() == null) {
                "Xray runtime could not be stopped before restart"
            }
            val pfd = intent.parcelable<ParcelFileDescriptor>(XrayRuntimeProtocol.EXTRA_TUN)
                ?: error("Xray TUN descriptor is missing")
            val config = intent.getStringExtra(XrayRuntimeProtocol.EXTRA_CONFIG)
                ?: error("Xray configuration is missing")
            val dns = intent.getStringExtra(XrayRuntimeProtocol.EXTRA_DNS)
                ?: error("Xray DNS endpoint is missing")
            val protectorBinder = intent.getBundleExtra(XrayRuntimeProtocol.EXTRA_PROTECTOR)
                ?.getBinder("binder")
                ?: error("Xray VPN protector is missing")

            val protector = object : XrayVpnProtector {
                override fun protect(fd: Int): Boolean =
                    XrayVpnProtectorBinderRemote(protectorBinder).protect(fd)
            }

            val api = XrayLibXrayApi()
            api.registerControllers(protector)
            val effectiveConfig = injectTun(config, pfd.fd)
            api.setDns(protector, dns)
            val result = api.run(effectiveConfig)
            if (!result.success) {
                pfd.close()
                error("libXray runXray failed: " + result.error)
            }

            tun = pfd
            running = true
            receiver?.send(XrayRuntimeProtocol.RESULT_OK, Bundle())
        }.onFailure { failure ->
            receiver?.send(
                XrayRuntimeProtocol.RESULT_FAILED,
                Bundle().apply {
                    putString(XrayRuntimeProtocol.RESULT_ERROR, failure.message ?: "Xray start failed")
                },
            )
        }
    }

    private fun handleStop(intent: Intent) {
        val receiver = intent.parcelable<ResultReceiver>(XrayRuntimeProtocol.EXTRA_RESULT)
        runCatching {
            check(stopRuntime() == null) {
                "Xray runtime stop failed"
            }
            receiver?.send(XrayRuntimeProtocol.RESULT_OK, Bundle())
        }.onFailure { failure ->
            receiver?.send(
                XrayRuntimeProtocol.RESULT_FAILED,
                Bundle().apply {
                    putString(XrayRuntimeProtocol.RESULT_ERROR, failure.message ?: "Xray stop failed")
                },
            )
        }
    }

    private fun stopRuntime(): Throwable? {
        if (!running && tun == null) return null

        var failure: Throwable? = null
        runCatching {
            val result = XrayLibXrayApi().stop()
            check(result.success) {
                result.error.ifBlank { "libXray stopXray failed" }
            }
        }.onFailure { failure = it }

        // Always release the platform-side descriptor even when the native
        // runtime refuses to stop. A failed native stop is still reported to
        // the caller so a new runtime cannot be started on top of an unknown
        // native state.
        runCatching { tun?.close() }
            .onFailure { closeFailure ->
                if (failure == null) failure = closeFailure
            }
        tun = null
        running = false

        runCatching { XrayLibXrayApi().resetDns() }
            .onFailure { dnsFailure ->
                if (failure == null) failure = dnsFailure
            }

        return failure
    }

    private fun injectTun(configText: String, tunFd: Int): String {
        val root = JSONObject(configText)
        val env = root.optJSONObject("env") ?: JSONObject().also { root.put("env", it) }
        env.put("xray.tun.fd", tunFd)

        val inbounds = root.optJSONArray("inbounds") ?: JSONArray().also { root.put("inbounds", it) }
        var hasTun = false
        for (i in 0 until inbounds.length()) {
            if (inbounds.optJSONObject(i)?.optString("protocol") == "tun") {
                hasTun = true
                break
            }
        }
        if (!hasTun) {
            inbounds.put(
                JSONObject()
                    .put("tag", "angelanexus-tun")
                    .put("port", 0)
                    .put("protocol", "tun")
                    .put("settings", JSONObject().put("name", "angelanexus").put("mtu", 1500)),
            )
        }
        return root.toString()
    }

    override fun onDestroy() {
        stopRuntime()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}

private inline fun <reified T : android.os.Parcelable> Intent.parcelable(key: String): T? =
    if (Build.VERSION.SDK_INT >= 33) {
        getParcelableExtra(key, T::class.java)
    } else {
        @Suppress("DEPRECATION")
        getParcelableExtra(key)
    }

private class XrayVpnProtectorBinderRemote(
    private val binder: IBinder,
) : XrayVpnProtector {
    override fun protect(fd: Int): Boolean {
        val data = Parcel.obtain()
        val reply = Parcel.obtain()
        return try {
            data.writeInt(fd)
            binder.transact(XrayVpnProtectorBinder.TRANSACTION_PROTECT, data, reply, 0)
            reply.readException()
            reply.readInt() != 0
        } finally {
            data.recycle()
            reply.recycle()
        }
    }
}

private data class XrayInvokeResult(
    val success: Boolean,
    val error: String,
)

private class XrayLibXrayApi {
    private val clazz = Class.forName("libXray.LibXray")

    fun invoke(request: String): XrayInvokeResult {
        val method = clazz.getMethod("invoke", String::class.java)
        val response = method.invoke(null, request) as String
        val json = JSONObject(response)
        return XrayInvokeResult(json.optBoolean("success", false), json.optString("error", ""))
    }

    fun run(config: String): XrayInvokeResult =
        invoke(JSONObject()
            .put("apiVersion", 3)
            .put("method", "runXray")
            .put("payload", JSONObject().put("xrayJson", config))
            .toString())

    fun stop(): XrayInvokeResult =
        invoke(JSONObject()
            .put("apiVersion", 3)
            .put("method", "stopXray")
            .put("payload", JSONObject())
            .toString())

    fun setDns(protector: XrayVpnProtector, dns: String) {
        invokeControllerMethod("setDNS", protector, dns)
    }

    fun resetDns() {
        runCatching { clazz.getMethod("resetDNS").invoke(null) }
    }

    fun registerControllers(protector: XrayVpnProtector) {
        invokeControllerMethod("registerDialerController", protector)
        invokeControllerMethod("registerListenerController", protector)
    }

    private fun invokeControllerMethod(name: String, protector: XrayVpnProtector, vararg extra: Any) {
        val controllerType = clazz.declaredClasses.firstOrNull { it.simpleName == "DialerController" }
            ?: error("libXray DialerController binding is unavailable")
        val proxy = Proxy.newProxyInstance(
            controllerType.classLoader,
            arrayOf(controllerType),
            InvocationHandler { _, method: Method, args: Array<out Any?>? ->
                if (method.name == "protectFd") {
                    val fd = args?.firstOrNull() as? Int ?: return@InvocationHandler false
                    protector.protect(fd)
                } else null
            },
        )
        if (extra.isEmpty()) {
            clazz.getMethod(name, controllerType).invoke(null, proxy)
        } else {
            clazz.getMethod(name, controllerType, String::class.java).invoke(null, proxy, extra[0])
        }
    }
}
