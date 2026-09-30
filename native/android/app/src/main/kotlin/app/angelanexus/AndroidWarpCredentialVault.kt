package app.angelanexus

import android.content.Context
import android.util.Base64
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Android secure-storage implementation for WARP credentials.
 *
 * Secrets are encrypted with an app-local Android Keystore AES key before
 * persistence. The user scope and credential id are authenticated data, so a
 * ciphertext cannot be reassigned to another scope without authentication
 * failure. Only opaque ciphertext and IV are stored in SharedPreferences.
 */
class AndroidWarpCredentialVault(
    context: Context,
) : WarpCredentialVault {
    private val preferences =
        context.applicationContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    private val keyStore: KeyStore =
        KeyStore.getInstance(ANDROID_KEYSTORE).apply {
            load(null)
        }

    override suspend fun put(
        userScopeId: String,
        credentialId: String,
        credential: ByteArray,
    ) {
        val scope = validatePart(userScopeId, "userScopeId")
        val id = validatePart(credentialId, "credentialId")
        require(credential.isNotEmpty()) { "credential must not be empty" }

        val aad = authenticatedData(scope, id)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey(), freshGcmSpec())
        cipher.updateAAD(aad)

        val ciphertext = cipher.doFinal(credential)
        val encoded = Base64.encodeToString(cipher.iv + ciphertext, Base64.NO_WRAP)

        check(
            preferences.edit()
                .putString(storageKey(scope, id), encoded)
                .commit()
        ) {
            "Unable to persist WARP credential"
        }
    }

    override suspend fun get(
        userScopeId: String,
        credentialId: String,
    ): ByteArray? {
        val scope = validatePart(userScopeId, "userScopeId")
        val id = validatePart(credentialId, "credentialId")
        val encoded = preferences.getString(storageKey(scope, id), null) ?: return null
        val packed = Base64.decode(encoded, Base64.DEFAULT)

        require(packed.size > GCM_IV_BYTES) { "Stored WARP credential is invalid" }

        val iv = packed.copyOfRange(0, GCM_IV_BYTES)
        val ciphertext = packed.copyOfRange(GCM_IV_BYTES, packed.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            secretKey(),
            GCMParameterSpec(GCM_TAG_BITS, iv),
        )
        cipher.updateAAD(authenticatedData(scope, id))
        return cipher.doFinal(ciphertext)
    }

    override suspend fun remove(
        userScopeId: String,
        credentialId: String,
    ) {
        val scope = validatePart(userScopeId, "userScopeId")
        val id = validatePart(credentialId, "credentialId")
        check(preferences.edit().remove(storageKey(scope, id)).commit()) {
            "Unable to remove WARP credential"
        }
    }

    private fun secretKey(): SecretKey {
        if (!keyStore.containsAlias(KEY_ALIAS)) {
            val generator = KeyGenerator.getInstance(KEY_ALGORITHM, ANDROID_KEYSTORE)
            generator.init(
                android.security.keystore.KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or
                        android.security.keystore.KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(
                        android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE,
                    )
                    .build(),
            )
            generator.generateKey()
        }

        val entry = keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry
            ?: error("WARP credential key is unavailable")
        return entry.secretKey
    }

    private fun authenticatedData(userScopeId: String, credentialId: String): ByteArray =
        (AAD_PREFIX + userScopeId + ":" + credentialId).toByteArray(StandardCharsets.UTF_8)

    private fun storageKey(userScopeId: String, credentialId: String): String =
        STORAGE_PREFIX + userScopeId + ":" + credentialId

    private fun validatePart(value: String, field: String): String {
        require(value.isNotBlank()) { "$field must not be blank" }
        require(value.length <= MAX_PART_LENGTH) { "$field is too long" }
        require(value.all { it.isLetterOrDigit() || it == '-' || it == '_' || it == '.' }) {
            "$field contains unsupported characters"
        }
        return value
    }

    private fun freshGcmSpec(): GCMParameterSpec =
        GCMParameterSpec(GCM_TAG_BITS, ByteArray(GCM_IV_BYTES).also {
            java.security.SecureRandom().nextBytes(it)
        })

    private companion object {
        const val PREFERENCES_NAME = "angelanexus_warp_credentials"
        const val STORAGE_PREFIX = "credential:"
        const val AAD_PREFIX = "angelanexus-warp-v1:"
        const val KEY_ALIAS = "angelanexus_warp_credentials_v1"
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALGORITHM = "AES"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_BITS = 128
        const val GCM_IV_BYTES = 12
        const val MAX_PART_LENGTH = 128
    }
}
