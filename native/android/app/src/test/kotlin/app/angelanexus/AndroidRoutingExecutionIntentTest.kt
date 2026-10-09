package app.angelanexus

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class AndroidRoutingExecutionIntentTest {
    @Test
    fun parsesCanonicalProxyIntentWithoutSelectingKernel() {
        val intent = AndroidRoutingExecutionIntent.parse(
            """{
                "version":1,
                "kind":"routing-execution-intent",
                "mode":"proxy",
                "action":"route",
                "target":"node-1",
                "ruleIds":["rule-app"],
                "application":{"packageName":"com.example.app"},
                "metadata":{"source":"routing-policy"}
            }""".trimIndent(),
        )

        assertEquals("proxy", intent.mode)
        assertEquals("route", intent.action)
        assertEquals("node-1", intent.target)
        assertEquals(listOf("rule-app"), intent.ruleIds)
        assertNotNull(intent.applicationJson)
        assertNotNull(intent.metadataJson)
    }

    @Test
    fun parsesExplicitTrafficAcceptancePolicy() {
        val intent = AndroidRoutingExecutionIntent.parse(
            """{
                "version":1,
                "kind":"routing-execution-intent",
                "mode":"proxy",
                "action":"route",
                "target":"node-1",
                "metadata":{
                    "trafficAcceptance":{
                        "required":true,
                        "targetUrl":"https://example.test/health",
                        "timeoutMs":7000,
                        "expectedResponseHeader":"X-Proxy-Egress",
                        "expectedResponseValue":"verified-egress"
                    }
                }
            }""".trimIndent(),
        )

        assertNotNull(intent.trafficAcceptance)
        assertEquals(true, intent.trafficAcceptance?.required)
        assertEquals("https://example.test/health", intent.trafficAcceptance?.targetUrl)
        assertEquals(7000, intent.trafficAcceptance?.timeoutMs)
        assertEquals("X-Proxy-Egress", intent.trafficAcceptance?.expectedResponseHeader)
        assertEquals("verified-egress", intent.trafficAcceptance?.expectedResponseValue)
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsRequiredTrafficAcceptanceWithoutProxyEvidenceMarker() {
        AndroidRoutingExecutionIntent.parse(
            """{
                "version":1,
                "kind":"routing-execution-intent",
                "mode":"proxy",
                "action":"route",
                "target":"node-1",
                "metadata":{
                    "trafficAcceptance":{
                        "required":true,
                        "targetUrl":"https://example.test/health"
                    }
                }
            }""".trimIndent(),
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsPlaintextTrafficAcceptanceTarget() {
        AndroidRoutingExecutionIntent.parse(
            """{
                "version":1,
                "kind":"routing-execution-intent",
                "mode":"proxy",
                "action":"route",
                "target":"node-1",
                "metadata":{
                    "trafficAcceptance":{
                        "required":true,
                        "targetUrl":"http://example.test/health"
                    }
                }
            }""".trimIndent(),
        )
    }

    @Test
    fun preservesOrderedChainHops() {
        val intent = AndroidRoutingExecutionIntent.parse(
            """{
                "version":1,
                "kind":"routing-execution-intent",
                "mode":"chain",
                "action":"chain",
                "hops":[{"node":"first"},{"node":"second"}]
            }""".trimIndent(),
        )

        assertEquals("chain", intent.mode)
        assertEquals("""[{"node":"first"},{"node":"second"}]""", intent.hopsJson)
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsModeActionMismatch() {
        AndroidRoutingExecutionIntent.parse(
            """{
                "version":1,
                "kind":"routing-execution-intent",
                "mode":"direct",
                "action":"route",
                "target":"node-1"
            }""".trimIndent(),
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsAmbiguousMissingTarget() {
        AndroidRoutingExecutionIntent.parse(
            """{
                "version":1,
                "kind":"routing-execution-intent",
                "mode":"proxy",
                "action":"route"
            }""".trimIndent(),
        )
    }
}
