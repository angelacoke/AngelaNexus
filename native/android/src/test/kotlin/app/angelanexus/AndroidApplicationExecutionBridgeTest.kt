package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AndroidApplicationExecutionBridgeTest {
    private fun context() = AndroidApplicationExecutionContext(
        stableIdentityKey = "android:package:com.example.app",
        applicationId = "com.example.app",
        processName = "com.example.app",
        ruleId = "app-proxy",
        action = "proxy",
    )

    @Test
    fun lifecycleDoesNotTreatActiveAsVerified() {
        val bridge = AndroidApplicationExecutionBridge()
        val context = context()

        bridge.planned(context)
        bridge.interceptionEstablished(context, "android-vpn", "mihomo")
        val active = bridge.active(context, "android-vpn", "mihomo")

        assertEquals(AndroidApplicationExecutionStage.ACTIVE, active.stage)
        assertFalse(active.verified)
        assertEquals("driver execution active; egress verification pending", active.reason)
    }

    @Test
    fun explicitVerificationIsRequired() {
        val bridge = AndroidApplicationExecutionBridge()
        val context = context()

        val verified = bridge.verified(
            context,
            driverId = "android-vpn",
            kernelId = "sing-box",
            reason = "egress probe matched expected route",
        )

        assertEquals(AndroidApplicationExecutionStage.VERIFIED, verified.stage)
        assertTrue(verified.verified)
        assertEquals(1L, verified.sequence)
    }

    @Test
    fun eventLedgerIsBoundedAndRetainsLatestEvents() {
        val bridge = AndroidApplicationExecutionBridge(maxEvents = 2)
        val context = context()

        bridge.planned(context)
        bridge.unverified(context, "android-vpn", "xray", "no verifier supplied")
        val stopped = bridge.stopped(context, "android-vpn", "xray")

        assertEquals(2, bridge.snapshot().size)
        assertEquals(2L, bridge.snapshot().first().sequence)
        assertEquals(stopped, bridge.snapshot().last())
    }
}
