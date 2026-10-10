package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class AndroidRuntimeHandoffStoreTest {
    @Test
    fun handoffIsConsumedExactlyOnceAndWrongTokenDoesNotConsumeIt() {
        val result = validResult()
        val token = AndroidRuntimeHandoffStore.publish(result)

        assertNull(AndroidRuntimeHandoffStore.consume("wrong-token"))
        assertEquals(result.configuration, AndroidRuntimeHandoffStore.consume(token)?.configuration)
        assertNull(AndroidRuntimeHandoffStore.consume(token))
    }

    @Test
    fun replacingOrDiscardingUsesTokenIdentity() {
        val oldToken = AndroidRuntimeHandoffStore.publish(validResult("old-config"))
        val newToken = AndroidRuntimeHandoffStore.publish(validResult("new-config"))

        AndroidRuntimeHandoffStore.discard(oldToken)
        assertEquals("new-config", AndroidRuntimeHandoffStore.consume(newToken)?.configuration)
        assertNull(AndroidRuntimeHandoffStore.consume(oldToken))
    }

    private fun validResult(configuration: String = "mixed-port: 7890") = CoreRuntimeImportResult(
        source = "local-file",
        nodeCount = 1,
        kernel = "mihomo",
        detectionConfidence = "explicit",
        configuration = configuration,
        executionIntentJson = """{"version":1,"kind":"routing-execution-intent","mode":"proxy","action":"route","target":"node-1"}""",
    )
}
