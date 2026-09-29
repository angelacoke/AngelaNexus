package app.angelanexus

import java.io.InputStream
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets

object ConfigImportReader {
    const val DEFAULT_MAX_BYTES = 5 * 1024 * 1024

    fun readUtf8(input: InputStream, maxBytes: Int = DEFAULT_MAX_BYTES): String {
        require(maxBytes > 0) { "maxBytes must be positive" }

        val buffer = ByteArray(8192)
        val output = java.io.ByteArrayOutputStream()
        var total = 0

        input.use { stream ->
            while (true) {
                val count = stream.read(buffer)
                if (count < 0) break
                if (total > maxBytes - count) {
                    throw IllegalArgumentException("configuration exceeds $maxBytes bytes")
                }
                output.write(buffer, 0, count)
                total += count
            }
        }

        val decoder = StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
        return decoder.decode(java.nio.ByteBuffer.wrap(output.toByteArray())).toString()
    }
}
