package app.angelanexus.ui

/** Minimum available width at which the Android shell switches to a navigation rail. */
internal const val NAVIGATION_RAIL_MIN_WIDTH_DP = 600

internal fun shouldUseNavigationRail(availableWidthDp: Int): Boolean =
    availableWidthDp >= NAVIGATION_RAIL_MIN_WIDTH_DP
