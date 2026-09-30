package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PendingConfigImportPortTest {
    @Test
    fun retainsOnlyTheLatestBoundedRequest() = kotlinx.coroutines.runBlocking {
        val port = PendingConfigImportPort()
        val first = ConfigImportRequest(
            version = ConfigImportRequest.VERSION,
            source = ConfigImportRequest.Source.TEXT,
            name = null,
            content = "first",
        )
        val second = ConfigImportRequest(
            version = ConfigImportRequest.VERSION,
            source = ConfigImportRequest.Source.LOCAL_FILE,
            name = "second.yaml",
            content = "second",
        )

        port.importConfiguration(first)
        assertEquals(first, port.latestRequest())

        port.importConfiguration(second)
        assertEquals(second, port.latestRequest())
        assertEquals("second.yaml", port.latestRequest()?.name)
    }

    @Test
    fun startsWithoutAStagedRequest() {
        assertNull(PendingConfigImportPort().latestRequest())
    }
}
