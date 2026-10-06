package app.angelanexus

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.assertFailsWith

class KernelRuntimeArtifactContractTest {
    private fun contract(
        distributionStatus: KernelRuntimeArtifactContract.DistributionStatus =
            KernelRuntimeArtifactContract.DistributionStatus.APPROVED,
        licenseReviewStatus: KernelRuntimeArtifactContract.ReviewStatus =
            KernelRuntimeArtifactContract.ReviewStatus.APPROVED,
        provenanceStatus: KernelRuntimeArtifactContract.ReviewStatus =
            KernelRuntimeArtifactContract.ReviewStatus.APPROVED,
        namingComplianceStatus: KernelRuntimeArtifactContract.ReviewStatus =
            KernelRuntimeArtifactContract.ReviewStatus.APPROVED,
    ) = KernelRuntimeArtifactContract(
        kernel = "mihomo",
        version = "v1.19.32",
        platform = "android",
        abi = "arm64-v8a",
        linkage = "embedded",
        artifactFileName = "libclash.so",
        sha256 = "667c94964d0a60f86cdcc130b2cdf3b385b02d9f2c5d3b324b3ed7a6b7326007",
        sourceRepository = "https://github.com/MetaCubeX/mihomo",
        sourceCommit = "88dcbf7f1614a67c3b36b848ee3592dfa92ada36",
        licenseId = "GPL-3.0",
        distributionStatus = distributionStatus,
        licenseReviewStatus = licenseReviewStatus,
        provenanceStatus = provenanceStatus,
        namingComplianceStatus = namingComplianceStatus,
    )

    @Test
    fun approvedContractRequiresEveryGate() {
        assertTrue(contract().isDistributionApproved())
        assertFalse(
            contract(
                licenseReviewStatus = KernelRuntimeArtifactContract.ReviewStatus.REQUIRED,
            ).isDistributionApproved(),
        )
        assertFalse(
            contract(
                provenanceStatus = KernelRuntimeArtifactContract.ReviewStatus.REQUIRED,
            ).isDistributionApproved(),
        )
        assertFalse(
            contract(
                namingComplianceStatus = KernelRuntimeArtifactContract.ReviewStatus.REQUIRED,
            ).isDistributionApproved(),
        )
        assertFalse(
            contract(
                distributionStatus = KernelRuntimeArtifactContract.DistributionStatus.BLOCKED,
            ).isDistributionApproved(),
        )
    }

    @Test
    fun invalidIntegrityMetadataIsRejected() {
        assertFailsWith<IllegalArgumentException> {
            contract().copy(sha256 = "not-a-sha256")
        }
        assertFailsWith<IllegalArgumentException> {
            contract().copy(sourceCommit = "short")
        }
    }
}
