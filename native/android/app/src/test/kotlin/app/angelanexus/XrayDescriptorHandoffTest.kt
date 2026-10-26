package app.angelanexus

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Test

class XrayDescriptorHandoffTest {
    private class FakeDescriptor : AutoCloseable {
        var closeCount = 0
        var failure: Throwable? = null
        override fun close() {
            closeCount += 1
            failure?.let { throw it }
        }
    }

    @Test
    fun closesDescriptorWhenStartupThrowsBeforeOwnershipTransfer() {
        val descriptor = FakeDescriptor()
        val startupFailure = IllegalStateException("native startup failed")
        val thrown = assertThrows(IllegalStateException::class.java) {
            XrayDescriptorHandoff(descriptor).use { throw startupFailure }
        }
        assertSame(startupFailure, thrown)
        assertEquals(1, descriptor.closeCount)
    }

    @Test
    fun runtimeOwnsDescriptorAfterSuccessfulTransfer() {
        val descriptor = FakeDescriptor()
        val owned = XrayDescriptorHandoff(descriptor).use { it.transfer() }
        assertSame(descriptor, owned)
        assertEquals(0, descriptor.closeCount)
        // stopRuntime, not the startup guard, must release a transferred descriptor.
        owned.close()
        assertEquals(1, descriptor.closeCount)
    }

    @Test
    fun startupFailureKeepsCleanupFailureAsSuppressedEvidence() {
        val descriptor = FakeDescriptor()
        val startupFailure = IllegalStateException("configuration invalid")
        val cleanupFailure = IllegalArgumentException("close failed")
        descriptor.failure = cleanupFailure
        val thrown = assertThrows(IllegalStateException::class.java) {
            XrayDescriptorHandoff(descriptor).use { throw startupFailure }
        }
        assertSame(startupFailure, thrown)
        assertSame(cleanupFailure, thrown.suppressed.single())
        assertEquals(1, descriptor.closeCount)
    }

    @Test
    fun closeIsIdempotentAndClosedDescriptorCannotBeTransferred() {
        val descriptor = FakeDescriptor()
        val handoff = XrayDescriptorHandoff(descriptor)
        handoff.close()
        handoff.close()
        assertEquals(1, descriptor.closeCount)
        assertThrows(IllegalStateException::class.java) { handoff.transfer() }
    }

    @Test
    fun descriptorCannotBeTransferredTwice() {
        val descriptor = FakeDescriptor()
        val handoff = XrayDescriptorHandoff(descriptor)
        handoff.transfer()
        assertThrows(IllegalStateException::class.java) { handoff.transfer() }
        handoff.close()
        assertEquals(0, descriptor.closeCount)
    }

    @Test
    fun failedCloseCanBeRetriedWithoutLosingTheDescriptor() {
        val descriptor = FakeDescriptor()
        val handoff = XrayDescriptorHandoff(descriptor)
        descriptor.failure = IllegalStateException("transient close failure")
        assertThrows(IllegalStateException::class.java) { handoff.close() }
        descriptor.failure = null
        handoff.close()
        handoff.close()
        assertEquals(2, descriptor.closeCount)
    }

    @Test
    fun pendingDnsResetRequiresCleanupRetryAfterDescriptorIsClosed() {
        assertEquals(true, xrayRuntimeCleanupRequired(
            running = false,
            descriptorPresent = false,
            dnsResetPending = true,
        ))
    }
}
