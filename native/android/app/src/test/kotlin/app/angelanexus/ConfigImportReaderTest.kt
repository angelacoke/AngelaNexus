package app.angelanexus

import java.io.ByteArrayInputStream
import java.nio.charset.StandardCharsets
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class ConfigImportReaderTest {
    @Test
    fun readsValidUtf8() {
        val input = "mihomo: 配置"
        val result = ConfigImportReader.readUtf8(
            ByteArrayInputStream(input.toByteArray(StandardCharsets.UTF_8))
        )

        assertEquals(input, result)
    }

    @Test
    fun rejectsMalformedUtf8() {
        val malformed = byteArrayOf(0xC3.toByte(), 0x28)

        assertFailsWith<IllegalArgumentException> {
            ConfigImportReader.readUtf8(ByteArrayInputStream(malformed))
        }
    }

    @Test
    fun rejectsPayloadOverLimit() {
        val input = ByteArrayInputStream(ByteArray(11) { 'x'.code.toByte() })

        assertFailsWith<IllegalArgumentException> {
            ConfigImportReader.readUtf8(input, maxBytes = 10)
        }
    }

    @Test
    fun rejectsNonPositiveLimit() {
        assertFailsWith<IllegalArgumentException> {
            ConfigImportReader.readUtf8(ByteArrayInputStream(byteArrayOf(1)), maxBytes = 0)
        }
    }
}
