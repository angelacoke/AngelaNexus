package app.angelanexus

/**
 * Secure credential storage boundary for user-scoped WARP landing credentials.
 *
 * Implementations must never expose credential material through references,
 * logs, diagnostics, or ordinary configuration serialization.
 */
interface WarpCredentialVault {
    suspend fun put(userScopeId: String, credentialId: String, credential: ByteArray)
    suspend fun get(userScopeId: String, credentialId: String): ByteArray?
    suspend fun remove(userScopeId: String, credentialId: String)
}
