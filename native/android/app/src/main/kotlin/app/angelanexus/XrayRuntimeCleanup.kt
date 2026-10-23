package app.angelanexus

/** DNS teardown can remain pending after native stop and descriptor release. */
internal fun xrayRuntimeCleanupRequired(
    running: Boolean,
    descriptorPresent: Boolean,
    dnsResetPending: Boolean,
): Boolean = running || descriptorPresent || dnsResetPending
