package app.angelanexus

import org.junit.Assert.assertEquals
import org.junit.Test

class XrayRuntimeCleanupTest {
    @Test
    fun onlyFullyCleanRuntimeMaySkipCleanup() {
        for (running in listOf(false, true)) {
            for (descriptorPresent in listOf(false, true)) {
                for (dnsResetPending in listOf(false, true)) {
                    val clean = !running && !descriptorPresent && !dnsResetPending
                    assertEquals(
                        "running=$running descriptor=$descriptorPresent dnsPending=$dnsResetPending",
                        !clean,
                        xrayRuntimeCleanupRequired(running, descriptorPresent, dnsResetPending),
                    )
                }
            }
        }
    }
}
