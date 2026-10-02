package app.angelanexus

import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import android.content.res.Configuration
import java.util.Locale

object AndroidLocalePreference {
    private const val PREFS = "angelanexus.preferences"
    private const val KEY_LOCALE = "locale"

    val supportedTags = listOf("en", "zh-CN", "ru", "fa")

    fun load(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_LOCALE, null)
            ?.takeIf { it in supportedTags }

    fun save(context: Context, tag: String) {
        require(tag in supportedTags) { "Unsupported locale: $tag" }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_LOCALE, tag).apply()
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove(KEY_LOCALE).apply()
    }

    fun wrap(context: Context): Context {
        val tag = load(context) ?: return context
        val configuration = Configuration(context.resources.configuration)
        configuration.setLocale(Locale.forLanguageTag(tag))
        return context.createConfigurationContext(configuration)
    }
}

class LocaleAwareContext(base: Context) : ContextWrapper(AndroidLocalePreference.wrap(base))
