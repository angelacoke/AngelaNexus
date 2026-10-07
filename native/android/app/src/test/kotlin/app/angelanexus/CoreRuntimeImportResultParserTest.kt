package app.angelanexus

import org.json.JSONObject
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
        val intent = JSONObject(result.executionIntentJson ?: error("missing execution intent"))
        assertEquals(1, intent.getInt("version"))
        assertEquals("routing-execution-intent", intent.getString("kind"))
        assertEquals("proxy", intent.getString("mode"))
        assertEquals("route", intent.getString("action"))
        assertEquals("node-1", intent.getString("target"))
    }

    @Test
    fun rejectsNonSuccessPayload() {
        assertFailsWith<IllegalArgumentException> {
            CoreRuntimeImportResultParser.parse("""{"ok":false}""")
        }
    }
}
