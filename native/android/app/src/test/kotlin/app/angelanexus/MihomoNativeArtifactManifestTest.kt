package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class MihomoNativeArtifactManifestTest {
    @Test
    fun manifestPinsExpectedVersionAndSource() {
        assertEquals("v1.19.32", MihomoNativeArtifactManifest.VERSION)
        assertEquals(
            "88dcbf7f1614a67c3b36b848ee3592dfa92ada36",
            MihomoNativeArtifactManifest.SOURCE_COMMIT,
        )
    }

    @Test
    fun manifestResolvesOnlySupportedAbis() {
        assertEquals("arm64-v8a", MihomoNativeArtifactManifest.forAbi("arm64-v8a").abi)
        assertEquals("armeabi-v7a", MihomoNativeArtifactManifest.forAbi("armeabi-v7a").abi)
        assertEquals("x86_64", MihomoNativeArtifactManifest.forAbi("x86_64").abi)
        assertFailsWith<IllegalStateException> {
            MihomoNativeArtifactManifest.forAbi("x86")
        }
    }
}
