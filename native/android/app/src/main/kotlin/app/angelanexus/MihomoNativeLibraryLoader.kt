package app.angelanexus

import java.io.File

class MihomoNativeLibraryLoader(
    private val libraryDirectory: File,
    private val spec: MihomoNativeLibrarySpec,
    private val loadLibrary: (String) -> Unit = System::load,
) {
    fun load(): Result<Unit> {
        val library = File(libraryDirectory, spec.fileName)
        if (!spec.verify(library)) {
            return Result.failure(
                IllegalStateException(
                    "Mihomo native artifact verification failed for ${spec.abi}/${spec.fileName}",
                ),
            )
        }
        return runCatching { loadLibrary(library.absolutePath) }
    }
}
