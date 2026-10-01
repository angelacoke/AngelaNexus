package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AndroidTransparentModeTest {
    private fun capabilities(
        root: Boolean = false,
        authorized: Boolean = false,
        system: Boolean = true,
        backend: Boolean = false,
        processIdentity: Boolean = backend,
    ): AndroidRootTransparentAdapter.Capabilities {
        return AndroidRootTransparentAdapter.Capabilities(
            rootAvailable = root,
            rootAuthorized = authorized,
            systemVpnAvailable = system,
            tcp = backend,
            udp = backend,
            dns = backend,
            icmp = backend,
            ipv4 = backend,
            ipv6 = backend,
            uidIdentity = backend,
            localOutputCapture = backend,
            processIdentity = processIdentity,
            policyRouting = backend,
            atomicRollback = backend,
        )
    }

    @Test
    fun root_is_not_selected_from_root_permission_alone() {
        val result = selectAndroidTransparentMode(
            AndroidTransparentMode.ROOT,
            capabilities(root = true, authorized = true),
        )
        assertNull(result)
    }

    @Test
    fun auto_prefers_root_only_when_backend_contract_is_complete() {
        val result = selectAndroidTransparentMode(
            AndroidTransparentMode.AUTO,
            capabilities(root = true, authorized = true, backend = true),
        )
        assertEquals(AndroidTransparentMode.ROOT, result)
    }

    @Test
    fun root_core_readiness_does_not_require_process_identity() {
        val capabilities = capabilities(
            root = true,
            authorized = true,
            backend = true,
            processIdentity = false,
        )

        assertTrue(capabilities.rootBackendReady)
        assertFalse(capabilities.identityReady)
        assertEquals(AndroidTransparentMode.ROOT, selectAndroidTransparentMode(AndroidTransparentMode.ROOT, capabilities))
    }

    @Test
    fun auto_uses_system_when_root_backend_is_not_ready() {
        val result = selectAndroidTransparentMode(
            AndroidTransparentMode.AUTO,
            capabilities(root = true, authorized = true, backend = false),
        )
        assertEquals(AndroidTransparentMode.SYSTEM, result)
    }

    @Test
    fun system_mode_does_not_depend_on_root() {
        val result = selectAndroidTransparentMode(
            AndroidTransparentMode.SYSTEM,
            capabilities(root = false, authorized = false, system = true),
        )
        assertEquals(AndroidTransparentMode.SYSTEM, result)
    }
}
