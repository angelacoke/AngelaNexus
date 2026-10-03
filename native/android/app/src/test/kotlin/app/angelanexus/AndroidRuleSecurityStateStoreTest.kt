package app.angelanexus

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertFailsWith

class AndroidRuleSecurityStateStoreTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @Test
    fun missingStateReturnsNull() {
        val store = AndroidRuleSecurityStateStore(context)
        assertNull(store.loadEnvelope())
        assertNull(store.loadAnchor())
    }

    @Test
    fun envelopeAndAnchorRoundTrip() {
        val store = AndroidRuleSecurityStateStore(context)
        val checksum = "a".repeat(64)
        store.saveEnvelope("{"generation":1}")
        store.saveAnchor(AndroidRuleSecurityStateStore.Anchor(1, checksum))
        assertEquals("{"generation":1}", store.loadEnvelope())
        assertEquals(AndroidRuleSecurityStateStore.Anchor(1, checksum), store.loadAnchor())
    }

    @Test
    fun tamperedEnvelopeFailsAuthentication() {
        val store = AndroidRuleSecurityStateStore(context)
        store.saveEnvelope("{"generation":1}")
        val prefs = context.getSharedPreferences("angelanexus_rule_security_state", Context.MODE_PRIVATE)
        val encoded = prefs.getString("sealed-envelope", null)!!
        val chars = encoded.toCharArray()
        chars[chars.lastIndex] = if (chars.last() == 'A') 'B' else 'A'
        prefs.edit().putString("sealed-envelope", String(chars)).commit()
        assertFailsWith<Exception> { store.loadEnvelope() }
    }
}
