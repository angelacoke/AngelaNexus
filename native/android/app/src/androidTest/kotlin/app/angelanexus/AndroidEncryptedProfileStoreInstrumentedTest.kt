package app.angelanexus

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.security.KeyStore
import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidEncryptedProfileStoreInstrumentedTest {
    @Test
    fun keystoreBackedProfilesPersistAsCiphertextAndSupportCrud() {
        val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
        val testId = UUID.randomUUID().toString()
        val directory = File(context.noBackupFilesDir, "profile-store-test-$testId")
        val alias = "app.angelanexus.test.profile.$testId"
        val cipher = AndroidKeystoreProfileCipher(alias)
        val store = AndroidEncryptedProfileStore(directory, cipher)
        val profileName = "integration-private-name-$testId"
        val secretConfig = "mixed-port: 7890\npassword: integration-secret-$testId"

        try {
            val first = store.saveProfile(profileName, secretConfig)
            val second = store.saveProfile("second-$testId", "mixed-port: 7891")
            val storedKey = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
                .getKey(alias, null) as? javax.crypto.SecretKey
            assertTrue(storedKey != null)
            assertEquals("AES", storedKey?.algorithm)
            assertEquals(null, storedKey?.encoded)
            assertEquals(second.id, store.snapshot().activeProfileId)
            assertEquals(secretConfig, store.loadConfiguration(first.id))

            val files = Files.walk(directory.toPath()).use { paths ->
                paths.filter { Files.isRegularFile(it) }.toList()
            }
            assertTrue(files.isNotEmpty())
            files.forEach { path ->
                val bytes = Files.readAllBytes(path)
                val content = String(bytes, StandardCharsets.ISO_8859_1)
                assertFalse(content.contains(profileName))
                assertFalse(content.contains(secretConfig))
                assertFalse(content.contains("integration-secret-$testId"))
            }
            assertTrue(directory.canonicalPath.startsWith(context.noBackupFilesDir.canonicalPath + File.separator))

            val reloaded = AndroidEncryptedProfileStore(directory, AndroidKeystoreProfileCipher(alias))
            assertEquals(secretConfig, reloaded.loadConfiguration(first.id))
            val firstFile = File(directory, "profile-${first.id}.enc")
            val originalCiphertext = Files.readAllBytes(firstFile.toPath())
            val modifiedCiphertext = originalCiphertext.copyOf().apply {
                this[this.lastIndex] = (this.last().toInt() xor 1).toByte()
            }
            Files.write(firstFile.toPath(), modifiedCiphertext)
            var authenticationFailureObserved = false
            try {
                reloaded.loadConfiguration(first.id)
            } catch (_: AndroidProfileStoreException) {
                authenticationFailureObserved = true
            }
            assertTrue(authenticationFailureObserved)
            assertEquals(2, reloaded.snapshot().profiles.size)
            Files.write(firstFile.toPath(), originalCiphertext)

            assertEquals(first.id, reloaded.renameProfile(first.id, "renamed-$testId").profiles.first().id)
            assertEquals(first.id, reloaded.setActiveProfile(first.id).activeProfileId)
            assertEquals(listOf("renamed-$testId", "second-$testId"), reloaded.snapshot().profiles.map { it.name })

            val afterDelete = reloaded.deleteProfile(first.id)
            assertEquals(listOf("second-$testId"), afterDelete.profiles.map { it.name })
            assertEquals(null, afterDelete.activeProfileId)
            assertFalse(File(directory, "profile-${first.id}.enc").exists())
        } finally {
            directory.deleteRecursively()
            KeyStore.getInstance("AndroidKeyStore").apply {
                load(null)
                if (containsAlias(alias)) deleteEntry(alias)
            }
        }
    }
}
