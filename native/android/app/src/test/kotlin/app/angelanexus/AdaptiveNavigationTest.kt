package app.angelanexus

import app.angelanexus.ui.NAVIGATION_RAIL_MIN_WIDTH_DP
import app.angelanexus.ui.shouldUseNavigationRail
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AdaptiveNavigationTest {
    @Test
    fun compactWidthsKeepBottomNavigation() {
        assertFalse(shouldUseNavigationRail(NAVIGATION_RAIL_MIN_WIDTH_DP - 1))
    }

    @Test
    fun tabletAndExpandedWidthsUseNavigationRail() {
        assertTrue(shouldUseNavigationRail(NAVIGATION_RAIL_MIN_WIDTH_DP))
        assertTrue(shouldUseNavigationRail(840))
    }
}
