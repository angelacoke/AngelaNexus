package app.angelanexus

import java.util.concurrent.Executors

/**
 * Serializes VPN runtime lifecycle work away from Android's main thread.
 * A single worker keeps start, stop, and cleanup mutations ordered.
 */
internal class AndroidRuntimeOperationQueue(
    threadName: String = "AngelaNexusVpnRuntime",
) {
    private val executor = Executors.newSingleThreadExecutor { task ->
        Thread(task, threadName).apply { isDaemon = true }
    }

    fun execute(operation: () -> Unit) {
        executor.execute { operation() }
    }

    fun shutdown() {
        executor.shutdown()
    }
}
