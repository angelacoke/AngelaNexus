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

    val ARM64_V8A = MihomoNativeLibrarySpec(
        abi = "arm64-v8a",
        sha256 = "667c94964d0a60f86cdcc130b2cdf3b385b02d9f2c5d3b324b3ed7a6b7326007",
    )

    val ARMEABI_V7A = MihomoNativeLibrarySpec(
        abi = "armeabi-v7a",
        sha256 = "3ae94d7defb1778cd611eceffcff6884407893d28c42a4350af2b49108ac9a09",
    )

    val X86_64 = MihomoNativeLibrarySpec(
        abi = "x86_64",
        sha256 = "da7bcdbf165cc1e3457d3560b51e703cb3a478dd83f0c1cfe42ccf676d6c1f42",
    )

    fun forAbi(abi: String): MihomoNativeLibrarySpec =
        when (abi) {
            ARM64_V8A.abi -> ARM64_V8A
            ARMEABI_V7A.abi -> ARMEABI_V7A
            X86_64.abi -> X86_64
            else -> error("Unsupported Mihomo Android ABI: $abi")
        }
}
