package app.angelanexus

/**
 * Native lifecycle bridge for the platform-neutral transparent runtime contract.
 *
 * Root mode is exposed only when the verified Root adapter is ready. System VPN
 * remains a separate backend and is not represented as Root transparent mode.
 */
class AndroidTransparentRuntimeBridge(
    private val rootAdapter: AndroidRootTransparentAdapter,
) {
    enum class Mode { ROOT }

    data class Capability(
        val mode: Mode,
        val supported: Boolean,
        val reason: String,
    )

    data class LifecycleResult(
        val ok: Boolean,
        val state: String,
        val reason: String,
    )

    private var preparedConfig: RootTransparentConfig? = null
    private var runtime: AndroidRootTransparentRuntime? = null

    fun inspectRootCapability(): Capability {
        val supported = rootAdapter.inspect().rootBackendReady
        return Capability(
            mode = Mode.ROOT,
            supported = supported,
            reason = if (supported) "verified-root-capability" else "root-capability-unavailable",
        )
    }

    fun prepare(config: RootTransparentConfig): LifecycleResult {
        check(runtime == null) { "transparent runtime already active" }
        if (!inspectRootCapability().supported) {
            return LifecycleResult(false, "idle", "root-capability-unavailable")
        }
        return try {
            rootAdapter.begin(config)
            preparedConfig = config
            LifecycleResult(true, "prepared", "prepared")
        } catch (_: Throwable) {
            preparedConfig = null
            LifecycleResult(false, "idle", "prepare-failed")
        }
    }

    fun apply(): LifecycleResult {
        val config = preparedConfig ?: return LifecycleResult(false, "idle", "not-prepared")
        if (!inspectRootCapability().supported) {
            preparedConfig = null
            return LifecycleResult(false, "idle", "root-capability-lost")
        }

        return try {
            runtime = rootAdapter.activate(config)
            preparedConfig = null
            LifecycleResult(true, "active", "applied")
        } catch (_: Throwable) {
            runtime = null
            preparedConfig = null
            LifecycleResult(false, "rolled-back", "apply-failed")
        }
    }

    fun verify(): LifecycleResult {
        val active = runtime ?: return LifecycleResult(false, "idle", "not-active")
        return try {
            active.healthCheck()
            LifecycleResult(true, "active", "verified")
        } catch (_: Throwable) {
            runtime = null
            LifecycleResult(false, "failed", "verification-failed")
        }
    }

    fun rollback(): LifecycleResult {
        val active = runtime
        if (active == null) {
            preparedConfig = null
            return LifecycleResult(true, "idle", "noop")
        }

        return try {
            active.stop()
            runtime = null
            LifecycleResult(true, "rolled-back", "rolled-back")
        } catch (_: Throwable) {
            LifecycleResult(false, "failed", "rollback-failed")
        }
    }
}
