package app.angelanexus

import org.json.JSONObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class CoreRuntimeImportResultParserTest {
    @Test
    fun parsesVerifiedCoreImportSummary() {
        val result = CoreRuntimeImportResultParser.parse(
            """{"ok":true,"result":{"version":1,"source":"local-file","nodeCount":1,"nodeSummaries":[{"name":"Japan","protocol":"vless","server":"jp.example","port":443}],"nodeSummariesTruncated":false,"kernel":"mihomo","detectionConfidence":"detected","configuration":"proxies: []\\n","executionIntent":{"version":1,"kind":"routing-execution-intent","mode":"proxy","action":"route","target":"node-1"}}}""",
        )

        assertEquals("local-file", result.source)
        assertEquals(1, result.nodeCount)
        assertEquals(listOf(CoreNodeSummary("Japan", "vless", "jp.example", 443)), result.nodeSummaries)
        assertEquals(false, result.nodeSummariesTruncated)
        assertEquals("mihomo", result.kernel)
        assertEquals("detected", result.detectionConfidence)
        assertEquals("proxies: []\\n", result.configuration)
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

    @Test
    fun rejectsCredentialFieldsInNodeSummary() {
        assertFailsWith<IllegalArgumentException> {
            CoreRuntimeImportResultParser.parse(
                """{"ok":true,"result":{"nodeCount":1,"nodeSummaries":[{"name":"Japan","protocol":"vless","server":"jp.example","port":443,"password":"must-not-cross"}]}}""",
            )
        }
    }

    @Test
    fun acceptsAConsistentlyTruncatedBoundedSummary() {
        val summaries = (0 until 100).joinToString(",") { index ->
            """{"name":"Node $index","protocol":null,"server":null,"port":null}"""
        }
        val result = CoreRuntimeImportResultParser.parse(
            """{"ok":true,"result":{"nodeCount":101,"nodeSummaries":[$summaries],"nodeSummariesTruncated":true}}""",
        )

        assertEquals(100, result.nodeSummaries.size)
        assertEquals(true, result.nodeSummariesTruncated)
    }

    @Test
    fun rejectsOverlongNodeSummaryFields() {
        val longName = "n".repeat(161)
        assertFailsWith<IllegalArgumentException> {
            CoreRuntimeImportResultParser.parse(
                """{"ok":true,"result":{"nodeCount":1,"nodeSummaries":[{"name":"$longName","protocol":null,"server":null,"port":null}],"nodeSummariesTruncated":false}}""",
            )
        }
    }
}
