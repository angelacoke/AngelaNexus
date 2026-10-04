package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class CoreRuntimeImportResultParserTest {
    @Test
    fun parsesVerifiedCoreImportSummary() {
        val result = CoreRuntimeImportResultParser.parse(
            """{"ok":true,"result":{"version":1,"source":"local-file","nodeCount":4,"kernel":"mihomo","detectionConfidence":"detected"}}""",
        )

        assertEquals("local-file", result.source)
        assertEquals(4, result.nodeCount)
        assertEquals("mihomo", result.kernel)
        assertEquals("detected", result.detectionConfidence)
    }

    @Test
    fun rejectsNonSuccessPayload() {
        assertFailsWith<IllegalArgumentException> {
            CoreRuntimeImportResultParser.parse("""{"ok":false}""")
        }
    }
}
