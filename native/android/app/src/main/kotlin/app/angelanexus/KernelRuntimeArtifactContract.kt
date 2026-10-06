package app.angelanexus

/**
 * Distribution contract for a replaceable kernel runtime artifact.
 *
 * Integrity verification and legal/distribution approval are deliberately
 * separate concerns: a byte-perfect artifact is not automatically approved
 * for distribution.
 */
data class KernelRuntimeArtifactContract(
    val kernel: String,
    val version: String,
    val platform: String,
    val abi: String,
    val linkage: String,
    val artifactFileName: String,
    val sha256: String,
    val sourceRepository: String,
    val sourceCommit: String,
    val licenseId: String,
    val distributionStatus: DistributionStatus,
    val licenseReviewStatus: ReviewStatus,
    val provenanceStatus: ReviewStatus,
    val namingComplianceStatus: ReviewStatus,
) {
    init {
        require(kernel.isNotBlank()) { "kernel must not be blank" }
        require(version.isNotBlank()) { "version must not be blank" }
        require(platform.isNotBlank()) { "platform must not be blank" }
        require(abi.isNotBlank()) { "abi must not be blank" }
        require(linkage.isNotBlank()) { "linkage must not be blank" }
        require(artifactFileName.isNotBlank()) { "artifactFileName must not be blank" }
        require(SHA256_PATTERN.matches(sha256)) {
            "sha256 must be 64 hexadecimal characters"
        }
        require(sourceRepository.startsWith("https://")) {
            "sourceRepository must use HTTPS"
        }
        require(sourceCommit.matches(COMMIT_PATTERN)) {
            "sourceCommit must be a full hexadecimal commit identifier"
        }
        require(licenseId.isNotBlank()) { "licenseId must not be blank" }
    }

    fun isDistributionApproved(): Boolean =
        distributionStatus == DistributionStatus.APPROVED &&
            licenseReviewStatus == ReviewStatus.APPROVED &&
            provenanceStatus == ReviewStatus.APPROVED &&
            namingComplianceStatus == ReviewStatus.APPROVED

    enum class DistributionStatus {
        BLOCKED,
        APPROVED,
    }

    enum class ReviewStatus {
        REQUIRED,
        APPROVED,
    }

    companion object {
        private val SHA256_PATTERN = Regex("[0-9a-fA-F]{64}")
        private val COMMIT_PATTERN = Regex("[0-9a-fA-F]{40}")
    }
}
