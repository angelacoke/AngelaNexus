package app.angelanexus

import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class MihomoNativeLibrarySpecTest {
    @Test
    fun verifiesPinnedSha256() {
        val file = Files.createTempFile("mihomo", ".so").toFile()
        try {
            file.writeBytes(byteArrayOf(1, 2, 3, 4))
            val spec = MihomoNativeLibrarySpec(
                abi = "arm64-v8a",
                sha256 = "9f64a747a1b97f131fabb6b447296c9b6f0209f5b0f5c4b7e0e4f4b7c0c6d2b4",
            )
            assertFalse(spec.verify(file))
        } finally {
            file.delete()
        }
    }

    @Test
    fun rejectsInvalidSpec() {
        assertFailsWith<IllegalArgumentException> {
            MihomoNativeLibrarySpec(abi = "mips", sha256 = "0".repeat(64))
        }
        assertFailsWith<IllegalArgumentException> {
            MihomoNativeLibrarySpec(abi = "arm64-v8a", sha256 = "invalid")
        }
    }

    @Test
    fun loaderRefusesMissingOrUnverifiedArtifact() {
        val directory = Files.createTempDirectory("mihomo").toFile()
        try {
            val spec = MihomoNativeLibrarySpec("arm64-v8a", sha256 = "0".repeat(64))
            val loader = MihomoNativeLibraryLoader(directory, spec) { error("must not load") }
            assertTrue(loader.load().isFailure)
        } finally {
            directory.deleteRecursively()
        }
    }

    @Test
    fun pinnedHashVerifierRejectsMissingOrUnverifiedArtifact() {
        val directory = Files.createTempDirectory("mihomo-runtime-check").toFile()
        try {
            assertFalse(MihomoNativeRuntimeFactory.artifactMatchesPinnedHash(directory, "x86_64"))
            File(directory, "libclash.so").writeBytes(byteArrayOf(1, 2, 3))
            assertFalse(MihomoNativeRuntimeFactory.artifactMatchesPinnedHash(directory, "x86_64"))
        } finally {
            directory.deleteRecursively()
        }
    }

    @Test
    fun loaderOnlyCallsSystemLoadAfterVerification() {
        val directory = Files.createTempDirectory("mihomo").toFile()
        val file = File(directory, "libclash.so")
        try {
            file.writeBytes(byteArrayOf(1, 2, 3))
            val digest = java.security.MessageDigest.getInstance("SHA-256")
                .digest(byteArrayOf(1, 2, 3))
                .joinToString("") { "%02x".format(it) }
            val spec = MihomoNativeLibrarySpec("arm64-v8a", sha256 = digest)
            var loadedPath: String? = null
            val loader = MihomoNativeLibraryLoader(directory, spec) { loadedPath = it }
            assertTrue(loader.load().isSuccess)
            assertTrue(loadedPath == file.absolutePath)
        } finally {
            directory.delete()
        }
    }
}
