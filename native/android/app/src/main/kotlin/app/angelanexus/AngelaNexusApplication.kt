package app.angelanexus

import android.app.Application

class AngelaNexusApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        installGlobalCrashLogger()
    }

    private fun installGlobalCrashLogger() {
        val default = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                val extDir = getExternalFilesDir(null) ?: filesDir
                val logFile = java.io.File(extDir, "crash.log")
                val writer = java.io.PrintWriter(java.io.FileWriter(logFile, true))
                writer.println("=== Crash at ${java.util.Date()} thread=${thread.name} ===")
                throwable.printStackTrace(writer)
                var cause = throwable.cause
                while (cause != null) {
                    writer.println("Caused by:")
                    cause.printStackTrace(writer)
                    cause = cause.cause
                }
                writer.println()
                writer.flush()
                writer.close()
            } catch (_: Exception) {
            }
            default?.uncaughtException(thread, throwable)
        }
    }
}
