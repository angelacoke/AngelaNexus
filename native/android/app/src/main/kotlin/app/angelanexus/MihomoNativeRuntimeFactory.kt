package app.angelanexus

import android.content.Context
import android.os.Build
import java.io.File

object MihomoNativeRuntimeFactory {
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
