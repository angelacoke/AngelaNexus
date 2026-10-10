package app.angelanexus

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.util.Locale
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class AndroidLocalProfileSummary(
    val id: String,
    val name: String,
    val createdAtEpochMillis: Long,
)

internal data class AndroidProfileStoreSnapshot(
    val profiles: List<AndroidLocalProfileSummary> = emptyList(),
    val activeProfileId: String? = null,
)

internal enum class AndroidProfileStoreFailure {
    INVALID_NAME,
    INVALID_CONFIGURATION,
    CONFIG_TOO_LARGE,
    DUPLICATE_NAME,
    PROFILE_LIMIT,
    PROFILE_NOT_FOUND,
    CORRUPT_OR_UNAVAILABLE,
}

internal class AndroidProfileStoreException(
    val failure: AndroidProfileStoreFailure,
    cause: Throwable? = null,
) : Exception("Encrypted Android profile storage operation failed: $failure", cause)

internal interface AndroidProfileCipher {
    fun seal(purpose: String, plaintext: ByteArray): ByteArray
    fun open(purpose: String, ciphertext: ByteArray): ByteArray
}

/** AES-GCM with an app-scoped, non-exportable Android Keystore key. */
internal class AndroidKeystoreProfileCipher(
    private val alias: String = DEFAULT_KEY_ALIAS,
) : AndroidProfileCipher {
    @Synchronized
    override fun seal(purpose: String, plaintext: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        cipher.updateAAD(aad(purpose))
        val nonce = cipher.iv ?: throw GeneralSecurityException("Android Keystore returned no GCM nonce")
        if (nonce.size != NONCE_BYTES) throw GeneralSecurityException("Unexpected GCM nonce size")
        val encrypted = cipher.doFinal(plaintext)
        return ByteArrayOutputStream(HEADER_BYTES + encrypted.size).use { output ->
            DataOutputStream(output).use { data ->
                data.writeInt(MAGIC)
                data.writeByte(ENVELOPE_VERSION)
                data.writeByte(nonce.size)
                data.write(nonce)
                data.write(encrypted)
            }
            output.toByteArray()
        }
    }

    @Synchronized
    override fun open(purpose: String, ciphertext: ByteArray): ByteArray {
        if (ciphertext.size < HEADER_BYTES + GCM_TAG_BYTES || ciphertext.size > MAX_ENVELOPE_BYTES) {
            throw GeneralSecurityException("Encrypted profile envelope has an invalid size")
        }
        val input = DataInputStream(ByteArrayInputStream(ciphertext))
        if (input.readInt() != MAGIC) throw GeneralSecurityException("Encrypted profile envelope has an invalid header")
        if (input.readUnsignedByte() != ENVELOPE_VERSION) {
            throw GeneralSecurityException("Unsupported encrypted profile envelope version")
        }
        val nonceSize = input.readUnsignedByte()
        if (nonceSize != NONCE_BYTES) throw GeneralSecurityException("Unexpected encrypted profile nonce size")
        val nonce = ByteArray(nonceSize)
        input.readFully(nonce)
        val encrypted = ByteArray(input.available())
        input.readFully(encrypted)
        if (encrypted.size < GCM_TAG_BYTES) throw GeneralSecurityException("Encrypted profile authentication tag is missing")

        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(GCM_TAG_BITS, nonce))
        cipher.updateAAD(aad(purpose))
        return cipher.doFinal(encrypted)
    }

    @Synchronized
    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val existing = keyStore.getKey(alias, null) as? SecretKey
        if (existing != null) return existing
        if (keyStore.containsAlias(alias)) {
            throw GeneralSecurityException("Android Keystore profile key is unavailable")
        }

        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE).run {
            init(
                KeyGenParameterSpec.Builder(
                    alias,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(KEY_BITS)
                    .setRandomizedEncryptionRequired(true)
                    .build(),
            )
            generateKey()
        }
    }

    private fun aad(purpose: String): ByteArray {
        require(purpose == INDEX_PURPOSE || PROFILE_PURPOSE.matches(purpose))
        return "AngelaNexus/android-profile-store/$ENVELOPE_VERSION/$purpose"
            .toByteArray(StandardCharsets.UTF_8)
    }

    companion object {
        private const val DEFAULT_KEY_ALIAS = "app.angelanexus.profile-store.aes-gcm.v1"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val MAGIC = 0x414E5052 // ANPR
        private const val ENVELOPE_VERSION = 1
        private const val KEY_BITS = 256
        private const val GCM_TAG_BITS = 128
        private const val GCM_TAG_BYTES = GCM_TAG_BITS / 8
        private const val NONCE_BYTES = 12
        private const val HEADER_BYTES = Int.SIZE_BYTES + 2 + NONCE_BYTES
        private const val MAX_ENVELOPE_BYTES = ConfigImportReader.DEFAULT_MAX_BYTES + 1024
        private const val INDEX_PURPOSE = "index"
        private val PROFILE_PURPOSE = Regex("profile:[0-9a-f-]{36}")
    }
}

/**
 * Persists imported Core configuration bytes only as authenticated ciphertext.
 * Both the encrypted index and profile bodies live under noBackupFilesDir; no
 * plaintext profile content or profile names are written to disk.
 */
internal class AndroidEncryptedProfileStore(
    private val directory: File,
    private val cipher: AndroidProfileCipher,
) {
    constructor(context: Context) : this(
        File(context.noBackupFilesDir, DIRECTORY_NAME),
        AndroidKeystoreProfileCipher(),
    )

    @Synchronized
    fun snapshot(): AndroidProfileStoreSnapshot = guarded {
        readIndex().also(::removeOrphanedProfileFiles)
    }

    @Synchronized
    fun saveProfile(name: String, configuration: String): AndroidLocalProfileSummary = guarded {
        val normalizedName = validateName(name)
        val configBytes = configuration.toByteArray(StandardCharsets.UTF_8)
        try {
            if (configBytes.isEmpty()) {
                throw AndroidProfileStoreException(AndroidProfileStoreFailure.INVALID_CONFIGURATION)
            }
            if (configBytes.size > ConfigImportReader.DEFAULT_MAX_BYTES) {
                throw AndroidProfileStoreException(AndroidProfileStoreFailure.CONFIG_TOO_LARGE)
            }

            val current = readIndex()
            ensureUniqueName(normalizedName, current.profiles)
            if (current.profiles.size >= MAX_PROFILES) {
                throw AndroidProfileStoreException(AndroidProfileStoreFailure.PROFILE_LIMIT)
            }

            val profile = AndroidLocalProfileSummary(
                id = UUID.randomUUID().toString(),
                name = normalizedName,
                createdAtEpochMillis = System.currentTimeMillis(),
            )
            val profileFile = profileFile(profile.id)
            val encrypted = cipher.seal(profilePurpose(profile.id), configBytes)
            writeAtomically(profileFile, encrypted)
            val updated = current.copy(
                profiles = current.profiles + profile,
                activeProfileId = profile.id,
            )
            try {
                writeIndex(updated)
            } catch (error: Exception) {
                profileFile.delete()
                throw error
            }
            removeOrphanedProfileFiles(updated)
            profile
        } finally {
            configBytes.fill(0)
        }
    }

    @Synchronized
    fun loadConfiguration(profileId: String): String {
        val plaintext = loadConfigurationBytes(profileId)
        return try {
            decodeUtf8(plaintext)
        } finally {
            plaintext.fill(0)
        }
    }

    @Synchronized
    fun loadConfigurationBytes(profileId: String): ByteArray = guarded {
        val current = readIndex()
        if (current.profiles.none { it.id == profileId }) {
            throw AndroidProfileStoreException(AndroidProfileStoreFailure.PROFILE_NOT_FOUND)
        }
        val encrypted = readBounded(profileFile(profileId), ConfigImportReader.DEFAULT_MAX_BYTES + MAX_ENVELOPE_OVERHEAD)
        val plaintext = try {
            cipher.open(profilePurpose(profileId), encrypted)
        } catch (error: Exception) {
            throw AndroidProfileStoreException(AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE, error)
        }
        try {
            if (plaintext.isEmpty() || plaintext.size > ConfigImportReader.DEFAULT_MAX_BYTES) {
                throw AndroidProfileStoreException(AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE)
            }
            plaintext
        } catch (error: Exception) {
            plaintext.fill(0)
            throw error
        }
    }

    @Synchronized
    fun setActiveProfile(profileId: String?): AndroidProfileStoreSnapshot = guarded {
        val current = readIndex()
        if (profileId != null && current.profiles.none { it.id == profileId }) {
            throw AndroidProfileStoreException(AndroidProfileStoreFailure.PROFILE_NOT_FOUND)
        }
        val updated = current.copy(activeProfileId = profileId)
        writeIndex(updated)
        removeOrphanedProfileFiles(updated)
        updated
    }

    @Synchronized
    fun renameProfile(profileId: String, name: String): AndroidProfileStoreSnapshot = guarded {
        val normalizedName = validateName(name)
        val current = readIndex()
        if (current.profiles.none { it.id == profileId }) {
            throw AndroidProfileStoreException(AndroidProfileStoreFailure.PROFILE_NOT_FOUND)
        }
        ensureUniqueName(normalizedName, current.profiles.filterNot { it.id == profileId })
        val updated = current.copy(
            profiles = current.profiles.map { if (it.id == profileId) it.copy(name = normalizedName) else it },
        )
        writeIndex(updated)
        updated
    }

    @Synchronized
    fun deleteProfile(profileId: String): AndroidProfileStoreSnapshot = guarded {
        val current = readIndex()
        if (current.profiles.none { it.id == profileId }) {
            throw AndroidProfileStoreException(AndroidProfileStoreFailure.PROFILE_NOT_FOUND)
        }
        val updated = current.copy(
            profiles = current.profiles.filterNot { it.id == profileId },
            activeProfileId = current.activeProfileId.takeUnless { it == profileId },
        )
        writeIndex(updated)
        removeOrphanedProfileFiles(updated)
        updated
    }

    private fun readIndex(): AndroidProfileStoreSnapshot {
        ensureDirectory()
        if (!indexFile().exists()) return AndroidProfileStoreSnapshot()
        val encrypted = readBounded(indexFile(), MAX_INDEX_BYTES)
        val plaintext = try {
            cipher.open(INDEX_PURPOSE, encrypted)
        } catch (error: Exception) {
            throw AndroidProfileStoreException(AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE, error)
        }
        return try {
            parseIndex(decodeUtf8(plaintext))
        } catch (error: AndroidProfileStoreException) {
            throw error
        } catch (error: Exception) {
            throw AndroidProfileStoreException(AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE, error)
        } finally {
            plaintext.fill(0)
        }
    }

    private fun parseIndex(serialized: String): AndroidProfileStoreSnapshot {
        val json = org.json.JSONObject(serialized)
        if (json.optInt("version", -1) != INDEX_VERSION) {
            throw AndroidProfileStoreException(AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE)
        }
        val entries = json.optJSONArray("profiles")
            ?: throw AndroidProfileStoreException(AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE)
        if (entries.length() > MAX_PROFILES) {
            throw AndroidProfileStoreException(AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE)
        }
        val profiles = ArrayList<AndroidLocalProfileSummary>(entries.length())
        val seenIds = mutableSetOf<String>()
        val seenNames = mutableSetOf<String>()
        for (index in 0 until entries.length()) {
            val entry = entries.optJSONObject(index)
                ?: throw AndroidProfileStoreException(AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE)
            val id = entry.optString("id", "")
            if (!isCanonicalProfileId(id) || !seenIds.add(id)) {
                throw AndroidProfileStoreException(AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE)
            }
            val name = try {
                validateName(entry.optString("name", ""))
            } catch (error: AndroidProfileStoreException) {
                throw AndroidProfileStoreException(AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE, error)
            }
            if (!seenNames.add(name.lowercase(Locale.ROOT))) {
                throw AndroidProfileStoreException(AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE)
            }
            val createdAt = entry.optLong("createdAtEpochMillis", -1)
            if (createdAt <= 0 || !profileFile(id).isFile) {
                throw AndroidProfileStoreException(AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE)
            }
            profiles += AndroidLocalProfileSummary(id, name, createdAt)
        }
        val activeId = if (json.isNull("activeProfileId")) null else json.optString("activeProfileId", "")
        if (activeId != null && profiles.none { it.id == activeId }) {
            throw AndroidProfileStoreException(AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE)
        }
        return AndroidProfileStoreSnapshot(profiles, activeId)
    }

    private fun writeIndex(snapshot: AndroidProfileStoreSnapshot) {
        ensureDirectory()
        val serialized = org.json.JSONObject()
            .put("version", INDEX_VERSION)
            .put("activeProfileId", snapshot.activeProfileId ?: org.json.JSONObject.NULL)
            .put("profiles", org.json.JSONArray().apply {
                snapshot.profiles.forEach { profile ->
                    put(
                        org.json.JSONObject()
                            .put("id", profile.id)
                            .put("name", profile.name)
                            .put("createdAtEpochMillis", profile.createdAtEpochMillis),
                    )
                }
            })
            .toString()
            .toByteArray(StandardCharsets.UTF_8)
        try {
            writeAtomically(indexFile(), cipher.seal(INDEX_PURPOSE, serialized))
        } finally {
            serialized.fill(0)
        }
    }

    private fun removeOrphanedProfileFiles(snapshot: AndroidProfileStoreSnapshot) {
        val referenced = snapshot.profiles.mapTo(mutableSetOf()) { it.id }
        directory.listFiles()
            ?.filter { it.name.startsWith(PROFILE_FILE_PREFIX) && it.name.endsWith(FILE_SUFFIX) }
            ?.forEach { file ->
                val id = file.name.removePrefix(PROFILE_FILE_PREFIX).removeSuffix(FILE_SUFFIX)
                if (id !in referenced) file.delete()
            }
    }

    private fun writeAtomically(target: File, bytes: ByteArray) {
        ensureDirectory()
        val temporary = File(directory, "${target.name}.tmp-${UUID.randomUUID()}")
        try {
            FileOutputStream(temporary).use { output ->
                output.write(bytes)
                output.fd.sync()
            }
            try {
                Files.move(
                    temporary.toPath(),
                    target.toPath(),
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING,
                )
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
            }
        } finally {
            temporary.delete()
        }
    }

    private fun readBounded(file: File, maxBytes: Int): ByteArray {
        if (!file.isFile || file.length() <= 0 || file.length() > maxBytes) {
            throw AndroidProfileStoreException(AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE)
        }
        return Files.readAllBytes(file.toPath())
    }

    private fun ensureDirectory() {
        if (!directory.exists() && !directory.mkdirs() && !directory.isDirectory) {
            throw AndroidProfileStoreException(AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE)
        }
        if (!directory.isDirectory) {
            throw AndroidProfileStoreException(AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE)
        }
    }

    private fun profileFile(id: String): File {
        if (!isCanonicalProfileId(id)) {
            throw AndroidProfileStoreException(AndroidProfileStoreFailure.PROFILE_NOT_FOUND)
        }
        return File(directory, "$PROFILE_FILE_PREFIX$id$FILE_SUFFIX")
    }

    private fun indexFile() = File(directory, INDEX_FILE_NAME)

    private fun ensureUniqueName(name: String, profiles: List<AndroidLocalProfileSummary>) {
        val normalizedName = name.lowercase(Locale.ROOT)
        if (profiles.any { it.name.lowercase(Locale.ROOT) == normalizedName }) {
            throw AndroidProfileStoreException(AndroidProfileStoreFailure.DUPLICATE_NAME)
        }
    }

    private fun validateName(name: String): String {
        val normalized = name.trim()
        if (normalized.isEmpty() || normalized.length > MAX_PROFILE_NAME_LENGTH || normalized.any { Character.isISOControl(it) }) {
            throw AndroidProfileStoreException(AndroidProfileStoreFailure.INVALID_NAME)
        }
        return normalized
    }

    private fun decodeUtf8(bytes: ByteArray): String {
        val decoder = StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
        return try {
            decoder.decode(ByteBuffer.wrap(bytes)).toString()
        } catch (error: java.nio.charset.CharacterCodingException) {
            throw AndroidProfileStoreException(AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE, error)
        }
    }

    private fun isCanonicalProfileId(id: String): Boolean = runCatching {
        UUID.fromString(id).toString() == id
    }.getOrDefault(false)

    private inline fun <T> guarded(block: () -> T): T = try {
        block()
    } catch (error: AndroidProfileStoreException) {
        throw error
    } catch (error: Exception) {
        throw AndroidProfileStoreException(AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE, error)
    }

    private fun profilePurpose(id: String) = "profile:$id"

    companion object {
        private const val DIRECTORY_NAME = "encrypted-profiles"
        private const val INDEX_FILE_NAME = "index.enc"
        private const val PROFILE_FILE_PREFIX = "profile-"
        private const val FILE_SUFFIX = ".enc"
        private const val INDEX_PURPOSE = "index"
        private const val INDEX_VERSION = 1
        internal const val MAX_PROFILES = 20
        internal const val MAX_PROFILE_NAME_LENGTH = 80
        private const val MAX_INDEX_BYTES = 128 * 1024
        private const val MAX_ENVELOPE_OVERHEAD = 64
    }
}
