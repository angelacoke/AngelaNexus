export const KERNEL_UPDATE_STATES = Object.freeze({
  CURRENT: "current",
  UPDATE_AVAILABLE: "update-available",
  REGISTRY_AHEAD: "registry-ahead",
  CANDIDATE: "candidate",
  CONFORMANCE_FAILED: "conformance-failed",
  APPROVED: "approved"
});

export const KERNEL_UPDATE_RISK = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high"
});

const REQUIRED_GATES = Object.freeze([
  "release-verified",
  "adapter-impact-reviewed",
  "unit-tests",
  "compatibility-tests",
  "kernel-conformance",
  "security-review",
  "user-approval"
]);

export function normalizeKernelVersion(value) {
  return String(value || "").trim().replace(/^v/i, "");
}

export function versionParts(value) {
  const normalized = normalizeKernelVersion(value);
  const match = normalized.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)];
}

export function compareKernelVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

function classifyPath(path) {
  const value = String(path || "").toLowerCase();
  if (/security|crypto|tls|transport|protocol|runtime|core/.test(value)) return "high";
  if (/config|schema|api|outbound|inbound|router|routing|dns|tun|wireguard/.test(value)) return "medium";
  return "low";
}

export function assessAdapterImpact(files = []) {
  const paths = files.map(file => typeof file === "string" ? file : file.filename).filter(Boolean);
  let risk = KERNEL_UPDATE_RISK.LOW;
  for (const path of paths) {
    const current = classifyPath(path);
    if (current === "high") return { risk: "high", paths };
    if (current === "medium") risk = "medium";
  }
  return { risk, paths };
}

export function createKernelUpdateCandidate({
  kernel,
  configuredVersion,
  upstreamVersion,
  release = {},
  changedFiles = []
} = {}) {
  const comparison = compareKernelVersions(upstreamVersion, configuredVersion);
  let state = KERNEL_UPDATE_STATES.CURRENT;
  if (comparison === null) state = KERNEL_UPDATE_STATES.UPDATE_AVAILABLE;
  else if (comparison > 0) state = KERNEL_UPDATE_STATES.UPDATE_AVAILABLE;
  else if (comparison < 0) state = KERNEL_UPDATE_STATES.REGISTRY_AHEAD;

  const impact = assessAdapterImpact(changedFiles);
  if (state === KERNEL_UPDATE_STATES.UPDATE_AVAILABLE) state = KERNEL_UPDATE_STATES.CANDIDATE;

  return Object.freeze({
    kernel,
    configuredVersion: normalizeKernelVersion(configuredVersion),
    upstreamVersion: normalizeKernelVersion(upstreamVersion),
    state,
    risk: impact.risk,
    release: {
      tag: release.tag || null,
      publishedAt: release.publishedAt || null,
      prerelease: release.prerelease === true
    },
    changedFiles: impact.paths,
    requiredGates: REQUIRED_GATES
  });
}

export function validateKernelUpdateGates(gates = {}) {
  const missing = REQUIRED_GATES.filter(name => gates[name] !== true);
  return Object.freeze({
    ok: missing.length === 0,
    missing,
    gates: { ...gates }
  });
}
