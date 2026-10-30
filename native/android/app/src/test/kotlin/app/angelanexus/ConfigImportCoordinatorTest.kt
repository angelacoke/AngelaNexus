package app.angelanexus

import java.io.ByteArrayInputStream
import java.nio.charset.StandardCharsets
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull

class ConfigImportCoordinatorTest {
    @Test
    fun convertsLocalFileIntoVersionedPortRequest() {
        var received: ConfigImportRequest? = null
        val expected = CoreRuntimeImportResult("local-file", 3, "mihomo", "detected")
        val port = recordingPort { received = it; expected }
        val coordinator = ConfigImportCoordinator(port)
        val content = "proxies:\n  - name: example"

        kotlinx.coroutines.runBlocking {
            val result = coordinator.importLocalFile(
                ByteArrayInputStream(content.toByteArray(StandardCharsets.UTF_8)),
                "config.yaml",
                ConfigImportRequest.TrafficAcceptancePolicy(
                    targetUrl = "https://example.test/health",
                    timeoutMs = 7000,
                ),
            )
            assertEquals(expected, result)
        }

        val request = assertNotNull(received)
        assertEquals(ConfigImportRequest.VERSION, request.version)
        assertEquals(ConfigImportRequest.Source.LOCAL_FILE, request.source)
        assertEquals("config.yaml", request.name)
        assertEquals(content, request.content)
        assertEquals(
            ConfigImportRequest.TrafficAcceptancePolicy(
                targetUrl = "https://example.test/health",
                timeoutMs = 7000,
            ),
            request.trafficAcceptance,
        )
    }

    @Test
    fun fetchesSubscriptionAndPreservesItsImportSource() {
        var received: ConfigImportRequest? = null
        var requestedUrl: String? = null
        val content = "vless://user@example.test:443#node"
        val coordinator = ConfigImportCoordinator(
            port = recordingPort { received = it; CoreRuntimeImportResult("subscription-url", 1, "xray", "detected") },
            subscriptionContentReader = SubscriptionContentReader { url ->
                requestedUrl = url
                content
            },
        )

        kotlinx.coroutines.runBlocking {
            coordinator.importSubscriptionUrl("https://example.test/sub?token=secret")
        }

        assertEquals("https://example.test/sub?token=secret", requestedUrl)
        val request = assertNotNull(received)
        assertEquals(ConfigImportRequest.Source.SUBSCRIPTION_URL, request.source)
        assertEquals(null, request.name)
        assertEquals(content, request.content)
    }

    @Test
    fun importsPastedTextThroughTheCoreTextSource() {
        var received: ConfigImportRequest? = null
        val content = "vless://a@example.test:443#one\nss://b@example.test:8388#two"
        val coordinator = ConfigImportCoordinator(
            port = recordingPort { received = it; CoreRuntimeImportResult("text", 2, "mihomo", "detected") },
        )

        kotlinx.coroutines.runBlocking { coordinator.importText(content) }

        val request = assertNotNull(received)
        assertEquals(ConfigImportRequest.Source.TEXT, request.source)
        assertEquals(content, request.content)
        assertEquals(null, request.name)
    }

    @Test
    fun rejectsPastedTextAboveTheSharedByteLimit() {
        val coordinator = ConfigImportCoordinator(
            port = recordingPort { error("oversized pasted text must not reach the Core port") },
        )

        kotlinx.coroutines.runBlocking {
            assertFailsWith<IllegalArgumentException> {
                coordinator.importText("x".repeat(ConfigImportCoordinator.MAX_CONTENT_BYTES + 1))
            }
        }
    }

    private fun recordingPort(
        onImport: (ConfigImportRequest) -> CoreRuntimeImportResult,
    ): ConfigImportPort = object : ConfigImportPort {
        override suspend fun importConfiguration(request: ConfigImportRequest): CoreRuntimeImportResult = onImport(request)
    }
}
