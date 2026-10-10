package app.angelanexus

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidRuntimeOperationQueueTest {
    @Test
    fun operationsRunSeriallyOnOneBackgroundThreadInSubmissionOrder() {
        val queue = AndroidRuntimeOperationQueue("test-angelanexus-vpn-runtime")
        val callerThread = Thread.currentThread()
        val workerThreads = ConcurrentHashMap.newKeySet<Thread>()
        val order = CopyOnWriteArrayList<Int>()
        val completed = CountDownLatch(3)

        try {
            repeat(3) { index ->
                queue.execute {
                    workerThreads += Thread.currentThread()
                    order += index
                    completed.countDown()
                }
            }

            assertTrue("queued operations should complete", completed.await(5, TimeUnit.SECONDS))
            assertEquals(listOf(0, 1, 2), order)
            assertEquals(1, workerThreads.size)
            assertFalse("runtime work must not run on the caller thread", workerThreads.contains(callerThread))
            assertEquals("test-angelanexus-vpn-runtime", workerThreads.single().name)
        } finally {
            queue.shutdown()
        }
    }
}
