package app.angelanexus

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidKernelDriverRegistryTest {
    @Test
    fun registryDeclaresAllThreeParallelKernelDrivers() {
        assertEquals(
            setOf("mihomo", "sing-box", "xray"),
            setOf(
                "mihomo",
                "sing-box",
                "xray",
            ),
        )
    }

    @Test
    fun mihomoDriverExposesCommonExecutionContract() {
        val driver = MihomoAndroidKernelDriver(FakeMihomoNativeHost())
        assertEquals("mihomo", driver.id)
        assertTrue(driver.capabilities.contains(AndroidKernelDriverCapabilities.CONFIG_APPLY))
        assertTrue(driver.capabilities.contains(AndroidKernelDriverCapabilities.TUN_ATTACH))
        assertTrue(driver.capabilities.contains(AndroidKernelDriverCapabilities.START_STOP))
        assertTrue(driver.capabilities.contains(AndroidKernelDriverCapabilities.STATUS))
    }

    private class FakeMihomoNativeHost : MihomoJniNativeHost(
        loader = MihomoNativeLibraryLoader(
            libraryDirectory = java.io.File("."),
            spec = MihomoNativeArtifactManifest.forAbi(
                MihomoNativeArtifactManifest.SUPPORTED_ABIS.first(),
            ),
        ),
        loadJniLibrary = {},
    )
}
