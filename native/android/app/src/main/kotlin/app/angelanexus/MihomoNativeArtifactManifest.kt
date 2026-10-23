package app.angelanexus

/**
 * Pinned Mihomo Android native artifacts for the reproducible v1.19.32 build.
 *
 * The SHA-256 values are for the extracted libclash.so files and are verified
 * again at runtime before the native core is loaded.
 */
object MihomoNativeArtifactManifest {
    const val VERSION = "v1.19.32"
    const val SOURCE_COMMIT = "88dcbf7f1614a67c3b36b848ee3592dfa92ada36"
    const val PATCHED_TPROXY_PACKET_SHA256 = "f417e4776d8dcdeb97b194fff2de83b76f3cf8e181ae01ee3fc15218fb376c5f"

    val ARM64_V8A = MihomoNativeLibrarySpec(
        abi = "arm64-v8a",
        sha256 = "b1153849d99633a439d4d96d03d16b722c93ee1e009e27a0b3361fbc173463f7",
    )

    val ARMEABI_V7A = MihomoNativeLibrarySpec(
        abi = "armeabi-v7a",
        sha256 = "17077edf5f9acf6ed8f0cabc3a5f3d1d072d4e15153c64d82503cf44f839e805",
    )

    val X86_64 = MihomoNativeLibrarySpec(
        abi = "x86_64",
        sha256 = "69e5c9c20925392cef960ff1bbb1d7006e5c195b568097623c04a0418013c98b",
    )

    fun forAbi(abi: String): MihomoNativeLibrarySpec =
        when (abi) {
            ARM64_V8A.abi -> ARM64_V8A
            ARMEABI_V7A.abi -> ARMEABI_V7A
            X86_64.abi -> X86_64
            else -> error("Unsupported Mihomo Android ABI: $abi")
        }
}
