package app.angelanexus

import java.io.File
import java.security.MessageDigest

data class MihomoNativeLibrarySpec(
    val abi: String,
    val fileName: String = "libclash.so",
    val sha256: String,
) {
    init {
        require(abi in SUPPORTED_ABIS) { "Unsupported Android ABI: $abi" }
        require(SHA256_PATTERN.matches(sha256)) { "sha256 must be 64 hexadecimal characters" }
    }

    fun verify(file: File): Boolean {
        if (!file.isFile) return false
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(8192)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                if (count > 0) digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }.equals(sha256, ignoreCase = true)
    }

    companion object {
        val SUPPORTED_ABIS = setOf("arm64-v8a", "armeabi-v7a", "x86_64")
        private val SHA256_PATTERN = Regex("[0-9a-fA-F]{64}")
    }
}
