package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class ConfigImportEnvelopeTest {
    @Test
    fun serializesVersionedLocalFileEnvelope() {
        val request = ConfigImportRequest(
            version = ConfigImportRequest.VERSION,
            source = ConfigImportRequest.Source.LOCAL_FILE,
            name = "profile.yaml",
            content = "mixed-port: 7890",
        )

        val payload = ConfigImportEnvelope.serialize(request)

        assertTrue(payload.contains("\"type\":\"angelanexus.config-import\""))
        assertTrue(payload.contains("\"version\":1"))
        assertTrue(payload.contains("\"source\":\"local-file\""))
        assertTrue(payload.contains("\"name\":\"profile.yaml\""))
        assertTrue(payload.contains("\"content\":\"mixed-port: 7890\""))
    }

    @Test
    fun serializesExplicitTrafficAcceptancePolicy() {
        val request = ConfigImportRequest(
            version = ConfigImportRequest.VERSION,
            source = ConfigImportRequest.Source.LOCAL_FILE,
            name = "profile.yaml",
            content = "mixed-port: 7890",
            trafficAcceptance = ConfigImportRequest.TrafficAcceptancePolicy(
                required = true,
                targetUrl = "https://example.test/health",
                timeoutMs = 7000,
            ),
        )

        val payload = ConfigImportEnvelope.serialize(request)

        assertTrue(payload.contains("\"trafficAcceptance\":{\"required\":true,\"targetUrl\":\"https://example.test/health\",\"timeoutMs\":7000}"))
    }

    @Test
    fun omitsTrafficAcceptanceWhenPolicyIsAbsent() {
        val request = ConfigImportRequest(
            version = ConfigImportRequest.VERSION,
            source = ConfigImportRequest.Source.TEXT,
            name = null,
            content = "vless://example",
        )

        val payload = ConfigImportEnvelope.serialize(request)

        assertTrue(!payload.contains("\"trafficAcceptance\""))
    }

    @Test
    fun preservesNullName() {
        val request = ConfigImportRequest(
            version = ConfigImportRequest.VERSION,
            source = ConfigImportRequest.Source.TEXT,
            name = null,
            content = "vless://example",
        )

        val payload = ConfigImportEnvelope.serialize(request)

        assertTrue(payload.contains("\"name\":null"))
    }

    @Test
    fun enforcesUtf8ByteLimit() {
        val request = ConfigImportRequest(
            version = ConfigImportRequest.VERSION,
            source = ConfigImportRequest.Source.TEXT,
            name = null,
            content = "配置".repeat(100),
        )

        assertFailsWith<IllegalArgumentException> {
            ConfigImportEnvelope.serialize(request, maxBytes = 100)
        }
    }

    @Test
    fun mapsAllSourcesToPlatformNeutralWireValues() {
        val sources = mapOf(
            ConfigImportRequest.Source.LOCAL_FILE to "local-file",
            ConfigImportRequest.Source.SUBSCRIPTION_URL to "subscription-url",
            ConfigImportRequest.Source.TEXT to "text",
            ConfigImportRequest.Source.STRUCTURED to "structured",
        )

        for ((source, wireValue) in sources) {
            val request = ConfigImportRequest(
                version = ConfigImportRequest.VERSION,
                source = source,
                name = null,
                content = "x",
            )
            assertTrue(
                ConfigImportEnvelope.serialize(request).contains("\"source\":\"$wireValue\""),
            )
        }
    }
}
