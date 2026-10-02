const LINKAGE_MODELS = new Set(["embedded", "ipc", "process"]);
const VERIFICATION_STATES = new Set(["unverified", "verified", "rejected"]);

export const RUNTIME_ARTIFACT_COMPLIANCE_VERSION = 1;

export const RUNTIME_LINKAGE_MODELS = Object.freeze([...LINKAGE_MODELS]);
export const RUNTIME_ARTIFACT_VERIFICATION_STATES = Object.freeze([...VERIFICATION_STATES]);

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(field + " is required");
  }
  return value.trim();
}

function normalizeSha256(value) {
  const sha = requiredString(value, "sha256").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new TypeError("sha256 must be a 64-character hexadecimal digest");
  return sha;
}

export function createRuntimeArtifactCompliance(input = {}) {
  const kernel = requiredString(input.kernel, "kernel");
  const version = requiredString(input.version, "version");
  const commit = requiredString(input.commit, "commit");
  const platform = requiredString(input.platform, "platform").toLowerCase();
  const abi = requiredString(input.abi, "abi");
  const sourceUrl = requiredString(input.sourceUrl, "sourceUrl");
  const sha256 = normalizeSha256(input.sha256);
  const license = requiredString(input.license, "license");
  const linkage = requiredString(input.linkage, "linkage").toLowerCase();
  if (!LINKAGE_MODELS.has(linkage)) throw new TypeError("unsupported runtime linkage model: " + linkage);

  const verification = requiredString(input.verification || "unverified", "verification").toLowerCase();
  if (!VERIFICATION_STATES.has(verification)) throw new TypeError("unsupported verification state: " + verification);

  const sourceAvailable = input.sourceAvailable === true;
  const provenanceVerified = input.provenanceVerified === true;
  const licenseReviewed = input.licenseReviewed === true;

  const releaseReady =
    verification === "verified" &&
    sourceAvailable &&
    provenanceVerified &&
    licenseReviewed;

  return Object.freeze({
    version: RUNTIME_ARTIFACT_COMPLIANCE_VERSION,
    kernel,
    artifact: Object.freeze({
      version,
      commit,
      platform,
      abi,
      sha256,
      sourceUrl,
    }),
    compliance: Object.freeze({
      license,
      linkage,
      sourceAvailable,
      provenanceVerified,
      licenseReviewed,
      verification,
      releaseReady,
    }),
  });
}

export function requireRuntimeArtifactCompliance(input) {
  const record = createRuntimeArtifactCompliance(input);
  if (!record.compliance.releaseReady) {
    throw new Error(
      "runtime artifact is not release-ready: " +
      [
        record.compliance.verification !== "verified" ? "verification" : null,
        !record.compliance.sourceAvailable ? "source-availability" : null,
        !record.compliance.provenanceVerified ? "provenance" : null,
        !record.compliance.licenseReviewed ? "license-review" : null,
      ].filter(Boolean).join(", "),
    );
  }
  return record;
}

export function isRuntimeArtifactReleaseReady(input) {
  try {
    return requireRuntimeArtifactCompliance(input).compliance.releaseReady;
  } catch {
    return false;
  }
}
