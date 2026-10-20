package app.angelanexus

/** Owns the startup descriptor until the runtime service explicitly takes it. */
internal class XrayDescriptorHandoff<T : AutoCloseable>(
    private val descriptor: T,
) : AutoCloseable {
    private var transferred = false
    private var closed = false

    fun transfer(): T {
        check(!closed && !transferred) { "descriptor ownership is no longer available" }
        transferred = true
        return descriptor
    }

    override fun close() {
        if (!transferred && !closed) {
            descriptor.close()
            closed = true
        }
    }
}
