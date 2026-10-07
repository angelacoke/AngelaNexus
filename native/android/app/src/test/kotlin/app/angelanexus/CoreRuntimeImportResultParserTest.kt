package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class CoreRuntimeImportResultParserTest {
    @Test
    fun parsesVerifiedCoreImportSummary() {
        val result = CoreRuntimeImportResultParser.parse(
            """{"ok":true,"result":{"version":1,"source":"local-file","nodeCount":4,"kernel":"mihomo","detectionConfidence":"detected","executionIntent":{"version":1,"kind":"routing-execution-intent","mode":"proxy","action":"route","target":"node-1"}}}""",
        )

        assertEquals("local-file", result.source)
        assertEquals(4, result.nodeCount)
        assertEquals("mihomo", result.kernel)
        assertEquals("detected", result.detectionConfidence)
        assertEquals(
            """{"version":1,"kind":"routing-execution-intent","mode":"proxy","action":"route","target":"node-1"}""",
            result.executionIntentJson,
        )
    }

    @Test
    fun rejectsNonSuccessPayload() {
        assertFailsWith<IllegalArgumentException> {
            CoreRuntimeImportResultParser.parse("""{"ok":false}""")
        }
    }
}
