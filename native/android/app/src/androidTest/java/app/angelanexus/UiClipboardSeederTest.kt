package app.angelanexus

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class UiClipboardSeederTest {
    @Test
    fun seedSystemClipboardFromRunnerArgument() {
        val text = InstrumentationRegistry.getArguments().getString("clipboardText")
            ?: throw AssertionError("Missing clipboardText instrumentation argument")
        check(text.isNotEmpty()) { "clipboardText instrumentation argument must not be empty" }

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("AngelaNexus UI test fixture", text))
    }
}
