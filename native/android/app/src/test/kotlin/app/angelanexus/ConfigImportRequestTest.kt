package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class ConfigImportRequestTest {
    @Test
    fun acceptsVersionOneEnvelope() {
        val request = ConfigImportRequest(
            version = ConfigImportRequest.VERSION,
            source = ConfigImportRequest.Source.LOCAL_FILE,
            name = "node.txt",
            content = "vless://example",
        )

        assertEquals(1, request.version)
        assertEquals(ConfigImportRequest.Source.LOCAL_FILE, request.source)
        assertEquals("node.txt", request.name)
        assertEquals("vless://example", request.content)
        assertEquals(null, request.trafficAcceptance)
    }

    @Test
    fun acceptsExplicitTrafficAcceptancePolicy() {
        val request = ConfigImportRequest(
            version = ConfigImportRequest.VERSION,
            source = ConfigImportRequest.Source.LOCAL_FILE,
            name = "node.txt",
            content = "vless://example",
            trafficAcceptance = ConfigImportRequest.TrafficAcceptancePolicy(
                targetUrl = "https://example.test/health",
                timeoutMs = 7000,
            ),
        )

        assertEquals(true, request.trafficAcceptance?.required)
        assertEquals("https://example.test/health", request.trafficAcceptance?.targetUrl)
        assertEquals(7000, request.trafficAcceptance?.timeoutMs)
    }

    @Test
    fun rejectsPlaintextTrafficAcceptanceTarget() {
        assertFailsWith<IllegalArgumentException> {
            ConfigImportRequest.TrafficAcceptancePolicy(
                targetUrl = "http://example.test/health",
            )
        }
    }

    @Test
    fun rejectsExcessiveTrafficAcceptanceTimeout() {
        assertFailsWith<IllegalArgumentException> {
            ConfigImportRequest.TrafficAcceptancePolicy(
                targetUrl = "https://example.test/health",
                timeoutMs = ConfigImportRequest.MAX_TRAFFIC_ACCEPTANCE_TIMEOUT_MS + 1,
            )
        }
    }

    @Test
    fun rejectsUnsupportedVersion() {
        assertFailsWith<IllegalArgumentException> {
            ConfigImportRequest(
                version = 2,
                source = ConfigImportRequest.Source.TEXT,
                name = null,
                content = "x",
            )
        }
    }

    @Test
    fun rejectsEmptyContent() {
        assertFailsWith<IllegalArgumentException> {
            ConfigImportRequest(
                version = ConfigImportRequest.VERSION,
                source = ConfigImportRequest.Source.TEXT,
                name = null,
                content = "",
            )
        }
    }

    @Test
    fun rejectsOverlongName() {
        assertFailsWith<IllegalArgumentException> {
            ConfigImportRequest(
                version = ConfigImportRequest.VERSION,
                source = ConfigImportRequest.Source.TEXT,
                name = "x".repeat(ConfigImportRequest.MAX_NAME_LENGTH + 1),
                content = "x",
            )
        }
    }
}
