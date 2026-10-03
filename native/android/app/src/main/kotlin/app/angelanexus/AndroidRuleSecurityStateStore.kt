package app.angelanexus

import android.content.Context
import android.util.Base64
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Android persistence primitives for the platform-neutral rule security state store.
 *
 * The sealed envelope and rollback anchor are encrypted and authenticated at rest
 * with an Android Keystore AES key. This does not claim rollback resistance
 * beyond the device/OS security boundary.
 */
class AndroidRuleSecurityStateStore(context: Context) {
    data class Anchor(val generation: Long, val checksum: String)

    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME, Context.MODE_PRIVATE
    )
    private val keyStore: KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    fun loadEnvelope(): String? =
        preferences.getString(ENVELOPE_KEY, null)?.let { decrypt(it, ENVELOPE_AAD) }

    fun saveEnvelope(envelope: String) {
        require(envelope.isNotBlank()) { "envelope must not be blank" }
        check(preferences.edit().putString(ENVELOPE_KEY, encrypt(envelope, ENVELOPE_AAD)).commit()) {
            "Unable to persist rule security state envelope"
        }
    }

    fun loadAnchor(): Anchor? {
        val encoded = preferences.getString(ANCHOR_KEY, null) ?: return null
        val parts = decrypt(encoded, ANCHOR_AAD).split(':', limit = 2)
        require(parts.size == 2) { "Stored rule security anchor is invalid" }
        val generation = parts[0].toLongOrNull()
            ?: error("Stored rule security anchor generation is invalid")
        require(generation >= 1) { "Stored rule security anchor generation is invalid" }
        val checksum = parts[1]
        require(SHA256_HEX.matches(checksum)) { "Stored rule security anchor checksum is invalid" }
        return Anchor(generation, checksum.lowercase())
    }

    fun saveAnchor(anchor: Anchor) {
        require(anchor.generation >= 1) { "anchor generation must be positive" }
        require(SHA256_HEX.matches(anchor.checksum)) { "anchor checksum must be SHA-256" }
        val value = anchor.generation.toString() + ":" + anchor.checksum.lowercase()
        check(preferences.edit().putString(ANCHOR_KEY, encrypt(value, ANCHOR_AAD)).commit()) {
            "Unable to persist rule security state anchor"
        }
    }

    private fun encrypt(value: String, aad: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey(), freshGcmSpec())
        cipher.updateAAD(aad.toByteArray(StandardCharsets.UTF_8))
        val ciphertext = cipher.doFinal(value.toByteArray(StandardCharsets.UTF_8))
        return Base64.encodeToString(cipher.iv + ciphertext, Base64.NO_WRAP)
    }

    private fun decrypt(value: String, aad: String): String {
        val packed = Base64.decode(value, Base64.DEFAULT)
        require(packed.size > GCM_IV_BYTES) { "Stored rule security state is invalid" }
        val iv = packed.copyOfRange(0, GCM_IV_BYTES)
        val ciphertext = packed.copyOfRange(GCM_IV_BYTES, packed.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        cipher.updateAAD(aad.toByteArray(StandardCharsets.UTF_8))
        return cipher.doFinal(ciphertext).toString(StandardCharsets.UTF_8)
    }

    private fun secretKey(): SecretKey {
        if (!keyStore.containsAlias(KEY_ALIAS)) {
            val generator = KeyGenerator.getInstance(KEY_ALGORITHM, ANDROID_KEYSTORE)
            generator.init(
                android.security.keystore.KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or
                        android.security.keystore.KeyProperties.PURPOSE_DECRYPT
                )
                    .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build()
            )
            generator.generateKey()
        }
        return (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey
            ?: error("Rule security state key is unavailable")
    }

    private fun freshGcmSpec(): GCMParameterSpec =
        GCMParameterSpec(GCM_TAG_BITS, ByteArray(GCM_IV_BYTES).also {
            java.security.SecureRandom().nextBytes(it)
        })

    private companion object {
        const val PREFERENCES_NAME = "angelanexus_rule_security_state"
        const val ENVELOPE_KEY = "sealed-envelope"
        const val ANCHOR_KEY = "secure-anchor"
        const val ENVELOPE_AAD = "angelanexus-rule-state-envelope-v1"
        const val ANCHOR_AAD = "angelanexus-rule-state-anchor-v1"
        const val KEY_ALIAS = "angelanexus_rule_security_state_v1"
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALGORITHM = "AES"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_BITS = 128
        const val GCM_IV_BYTES = 12
        val SHA256_HEX = Regex("^[a-fA-F0-9]{64}$")
    }
}
