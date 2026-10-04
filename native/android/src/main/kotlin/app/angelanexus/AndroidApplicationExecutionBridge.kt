package app.angelanexus

import android.util.Log
import java.util.Collections

/**
 * Android-side execution evidence bridge.
 *
 * The bridge joins the application decision with the native Android execution
 * lifecycle without selecting a kernel. It deliberately distinguishes:
 * - package interception established
 * - driver/kernel execution active
 * - actual egress verification
 *
 * "active" is never promoted to "verified" automatically.
 */
data class AndroidApplicationExecutionContext(
    val stableIdentityKey: String,
    val applicationId: String? = null,
    val processName: String? = null,
    val ruleId: String? = null,
    val action: String? = null,
) {
    init {
        require(stableIdentityKey.isNotBlank())
        require(applicationId == null || applicationId.isNotBlank())
        require(processName == null || processName.isNotBlank())
        require(ruleId == null || ruleId.isNotBlank())
        require(action == null || action in setOf("direct", "proxy", "reject", "bypass", "route", "chain"))
    }
}

enum class AndroidApplicationExecutionStage {
    PLANNED,
    INTERCEPTION_ESTABLISHED,
    ACTIVE,
    VERIFIED,
    UNVERIFIED,
    FAILED,
    STOPPED,
}

data class AndroidApplicationExecutionEvent(
    val stage: AndroidApplicationExecutionStage,
    val stableIdentityKey: String,
    val applicationId: String?,
    val processName: String?,
    val ruleId: String?,
    val action: String?,
    val driverId: String?,
    val kernelId: String?,
    val verified: Boolean,
    val reason: String?,
    val sequence: Long,
)

class AndroidApplicationExecutionBridge(
    private val maxEvents: Int = 64,
) {
    private val events = Collections.synchronizedList(mutableListOf<AndroidApplicationExecutionEvent>())
    private var sequence = 0L

    init {
        require(maxEvents > 0)
    }

    @Synchronized
    fun planned(context: AndroidApplicationExecutionContext): AndroidApplicationExecutionEvent =
        record(context, AndroidApplicationExecutionStage.PLANNED, null, null, false, "execution planned")

    @Synchronized
    fun interceptionEstablished(
        context: AndroidApplicationExecutionContext,
        driverId: String,
        kernelId: String?,
    ): AndroidApplicationExecutionEvent =
        record(
            context,
            AndroidApplicationExecutionStage.INTERCEPTION_ESTABLISHED,
            driverId,
            kernelId,
            false,
            "Android package interception boundary established",
        )

    @Synchronized
    fun active(
        context: AndroidApplicationExecutionContext,
        driverId: String,
        kernelId: String?,
    ): AndroidApplicationExecutionEvent =
        record(
            context,
            AndroidApplicationExecutionStage.ACTIVE,
            driverId,
            kernelId,
            false,
            "driver execution active; egress verification pending",
        )

    @Synchronized
    fun verified(
        context: AndroidApplicationExecutionContext,
        driverId: String,
        kernelId: String?,
        reason: String,
    ): AndroidApplicationExecutionEvent {
        require(reason.isNotBlank())
        return record(context, AndroidApplicationExecutionStage.VERIFIED, driverId, kernelId, true, reason)
    }

    @Synchronized
    fun unverified(
        context: AndroidApplicationExecutionContext,
        driverId: String?,
        kernelId: String?,
        reason: String,
    ): AndroidApplicationExecutionEvent {
        require(reason.isNotBlank())
        return record(context, AndroidApplicationExecutionStage.UNVERIFIED, driverId, kernelId, false, reason)
    }

    @Synchronized
    fun failed(
        context: AndroidApplicationExecutionContext,
        driverId: String?,
        kernelId: String?,
        reason: String,
    ): AndroidApplicationExecutionEvent {
        require(reason.isNotBlank())
        return record(context, AndroidApplicationExecutionStage.FAILED, driverId, kernelId, false, reason)
    }

    @Synchronized
    fun stopped(
        context: AndroidApplicationExecutionContext,
        driverId: String?,
        kernelId: String?,
    ): AndroidApplicationExecutionEvent =
        record(context, AndroidApplicationExecutionStage.STOPPED, driverId, kernelId, false, "execution stopped")

    fun snapshot(): List<AndroidApplicationExecutionEvent> =
        synchronized(events) { events.toList() }

    private fun record(
        context: AndroidApplicationExecutionContext,
        stage: AndroidApplicationExecutionStage,
        driverId: String?,
        kernelId: String?,
        verified: Boolean,
        reason: String?,
    ): AndroidApplicationExecutionEvent {
        sequence += 1
        val event = AndroidApplicationExecutionEvent(
            stage = stage,
            stableIdentityKey = context.stableIdentityKey,
            applicationId = context.applicationId,
            processName = context.processName,
            ruleId = context.ruleId,
            action = context.action,
            driverId = driverId,
            kernelId = kernelId,
            verified = verified,
            reason = reason,
            sequence = sequence,
        )
        if (events.size >= maxEvents) events.removeAt(0)
        events.add(event)
        Log.i(TAG, "application-execution stage=${stage.name.lowercase()} identity=${context.stableIdentityKey} driver=${driverId ?: "none"} kernel=${kernelId ?: "none"} verified=$verified reason=${reason ?: "none"}")
        return event
    }

    companion object {
        private const val TAG = "AngelaNexus/AppExec"
    }
}
