package app.angelanexus

import android.content.Context
import android.os.Build
import java.io.File

object MihomoNativeRuntimeFactory {
    fun hasVerifiedArtifact(context: Context): Boolean {
        if (!BuildConfig.MIHOMO_DISTRIBUTION_APPROVED) return false
        val abi = Build.SUPPORTED_ABIS.firstOrNull {
            it in MihomoNativeLibrarySpec.SUPPORTED_ABIS
        } ?: return false
        return artifactMatchesPinnedHash(File(context.applicationInfo.nativeLibraryDir), abi)
    }

    internal fun artifactMatchesPinnedHash(libraryDirectory: File, abi: String): Boolean =
        runCatching {
            val spec = MihomoNativeArtifactManifest.forAbi(abi)
            spec.verify(File(libraryDirectory, spec.fileName))
        }.getOrDefault(false)

    fun create(context: Context): MihomoJniNativeHost {
        val abi = Build.SUPPORTED_ABIS.firstOrNull {
            it in MihomoNativeLibrarySpec.SUPPORTED_ABIS
        } ?: error("No supported Mihomo Android ABI is available")

        val libraryDirectory = File(context.applicationInfo.nativeLibraryDir)
        val spec = MihomoNativeArtifactManifest.forAbi(abi)
        return MihomoJniNativeHost(
            loader = MihomoNativeLibraryLoader(libraryDirectory, spec),
        )
    }
}
