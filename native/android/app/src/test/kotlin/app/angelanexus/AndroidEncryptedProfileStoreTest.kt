package app.angelanexus

import java.io.File
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.security.MessageDigest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AndroidEncryptedProfileStoreTest {
    @Test
    fun profilesCanBeCreatedListedRestoredRenamedSelectedAndDeleted() {
        withStore { store, directory ->
            val firstConfig = "mixed-port: 7890\nsecret: first-secret"
            val secondConfig = "mixed-port: 7891\nsecret: second-secret"

            val first = store.saveProfile("  Work  ", firstConfig)
            assertEquals("Work", first.name)
            assertEquals(firstConfig, store.loadConfiguration(first.id))
            assertEquals(first.id, store.snapshot().activeProfileId)

            val second = store.saveProfile("Home", secondConfig)
            assertEquals(second.id, store.snapshot().activeProfileId)
            assertEquals(listOf("Work", "Home"), store.snapshot().profiles.map { it.name })
            assertEquals(secondConfig, store.loadConfiguration(second.id))

            val reloaded = AndroidEncryptedProfileStore(directory, TestCipher())
            assertEquals(second.id, reloaded.snapshot().activeProfileId)
            assertEquals(firstConfig, reloaded.loadConfiguration(first.id))

            val renamed = store.renameProfile(first.id, "Office")
            assertEquals(listOf("Office", "Home"), renamed.profiles.map { it.name })
            val selected = store.setActiveProfile(first.id)
            assertEquals(first.id, selected.activeProfileId)

            val deleted = store.deleteProfile(first.id)
            assertEquals(listOf("Home"), deleted.profiles.map { it.name })
            assertNull(deleted.activeProfileId)
            assertFailsWith<AndroidProfileStoreException> { store.loadConfiguration(first.id) }
        }
    }

    @Test
    fun diskFilesDoNotContainProfileNamesOrConfigurationText() {
        withStore { store, directory ->
            val name = "Private profile name"
            val config = "secret-token: never-on-disk-in-plaintext"
            store.saveProfile(name, config)

            val files = Files.walk(directory.toPath()).use { paths ->
                paths.filter { Files.isRegularFile(it) }.toList()
            }
            assertTrue(files.isNotEmpty())
            files.forEach { path ->
                val content = String(Files.readAllBytes(path), StandardCharsets.ISO_8859_1)
                assertFalse(content.contains(name))
                assertFalse(content.contains(config))
            }
        }
    }

    @Test
    fun rejectsDuplicateInvalidOversizedAndExcessProfiles() {
        withStore { store, _ ->
            store.saveProfile("Work", "valid config")
            val duplicate = assertFailsWith<AndroidProfileStoreException> {
                store.saveProfile("work", "another config")
            }
            assertEquals(AndroidProfileStoreFailure.DUPLICATE_NAME, duplicate.failure)

            val invalidName = assertFailsWith<AndroidProfileStoreException> {
                store.saveProfile("  \n ", "valid config")
            }
            assertEquals(AndroidProfileStoreFailure.INVALID_NAME, invalidName.failure)

            val oversized = "x".repeat(ConfigImportReader.DEFAULT_MAX_BYTES + 1)
            val tooLarge = assertFailsWith<AndroidProfileStoreException> {
                store.saveProfile("Too large", oversized)
            }
            assertEquals(AndroidProfileStoreFailure.CONFIG_TOO_LARGE, tooLarge.failure)

            repeat(AndroidEncryptedProfileStore.MAX_PROFILES - 1) { index ->
                store.saveProfile("Profile $index", "configuration-$index")
            }
            val full = assertFailsWith<AndroidProfileStoreException> {
                store.saveProfile("One too many", "configuration")
            }
            assertEquals(AndroidProfileStoreFailure.PROFILE_LIMIT, full.failure)
            assertEquals(AndroidEncryptedProfileStore.MAX_PROFILES, store.snapshot().profiles.size)
        }
    }

    @Test
    fun corruptEncryptedIndexIsNeverTreatedAsAnEmptyStore() {
        withStore { store, directory ->
            store.saveProfile("Work", "secret config")
            val index = File(directory, "index.enc")
            Files.write(index.toPath(), byteArrayOf(1, 2, 3, 4))

            val failure = assertFailsWith<AndroidProfileStoreException> { store.snapshot() }
            assertEquals(AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE, failure.failure)
            assertTrue(index.isFile)
        }
    }

    @Test
    fun changingProfilePurposeOrCiphertextFailsClosed() {
        withStore { store, directory ->
            val profile = store.saveProfile("Work", "secret config")
            val file = File(directory, "profile-${profile.id}.enc")
            val encrypted = Files.readAllBytes(file.toPath())
            encrypted[encrypted.lastIndex] = (encrypted.last().toInt() xor 1).toByte()
            Files.write(file.toPath(), encrypted)

            val failure = assertFailsWith<AndroidProfileStoreException> {
                store.loadConfiguration(profile.id)
            }
            assertEquals(AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE, failure.failure)
            assertNotNull(store.snapshot().profiles.singleOrNull())
        }
    }

    private fun withStore(block: (AndroidEncryptedProfileStore, File) -> Unit) {
        val directory = Files.createTempDirectory("angela-encrypted-profiles-").toFile()
        try {
            block(AndroidEncryptedProfileStore(directory, TestCipher()), directory)
        } finally {
            directory.deleteRecursively()
        }
    }

    private class TestCipher : AndroidProfileCipher {
        override fun seal(purpose: String, plaintext: ByteArray): ByteArray {
            val prefix = "TEST:$purpose:".toByteArray(StandardCharsets.UTF_8)
            val encrypted = plaintext.map { (it.toInt() xor 0x5a).toByte() }.toByteArray()
            return prefix + encrypted + checksum(prefix, plaintext)
        }

        override fun open(purpose: String, ciphertext: ByteArray): ByteArray {
            val prefix = "TEST:$purpose:".toByteArray(StandardCharsets.UTF_8)
            require(ciphertext.size > prefix.size + CHECKSUM_BYTES && ciphertext.copyOfRange(0, prefix.size).contentEquals(prefix))
            val encrypted = ciphertext.copyOfRange(prefix.size, ciphertext.size - CHECKSUM_BYTES)
            val plaintext = encrypted
                .map { (it.toInt() xor 0x5a).toByte() }
                .toByteArray()
            val actualChecksum = ciphertext.copyOfRange(ciphertext.size - CHECKSUM_BYTES, ciphertext.size)
            require(MessageDigest.isEqual(actualChecksum, checksum(prefix, plaintext)))
            return plaintext
        }

        private fun checksum(prefix: ByteArray, plaintext: ByteArray) =
            MessageDigest.getInstance("SHA-256").digest(prefix + plaintext)

        companion object { private const val CHECKSUM_BYTES = 32 }
    }
}
