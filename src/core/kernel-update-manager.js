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


export function validateReleaseProvenance({
  repository,
  expectedRepository,
  tag,
  releaseUrl,
} = {}) {
  const actualRepository = String(repository || "").trim();
  const expected = String(expectedRepository || "").trim();
  const normalizedTag = normalizeKernelVersion(tag);
  const url = String(releaseUrl || "").trim();
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  const expectedPath = expected && normalizedTag
    ? `/${expected}/releases/tag/v${normalizedTag}`
    : null;
  return Object.freeze({
    ok: Boolean(
      actualRepository &&
      expected &&
      actualRepository === expected &&
      normalizedTag &&
      parsed &&
      parsed.protocol === "https:" &&
      parsed.hostname === "github.com" &&
      parsed.pathname === expectedPath
    ),
    repository: actualRepository || null,
    expectedRepository: expected || null,
    tag: normalizedTag || null,
    releaseUrl: url || null,
  });
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


const IMPACT_DOMAINS = Object.freeze({
  security: /security|crypto|tls|certificate|reality|key|credential/i,
  transport: /transport|quic|http3|grpc|http|tcp|udp|wireguard|hysteria|tuic/i,
  routing: /route|router|routing|rule|dns|tun|inbound|outbound|selector|urltest/i,
  schema: /config|schema|api|json|yaml/i,
  runtime: /runtime|core|engine|dispatcher|dial|listener/i
});

export function analyzeKernelAdapterImpact(files = [], releaseNotes = "") {
  const paths = files.map(file => typeof file === "string" ? file : file.filename).filter(Boolean);
  const text = paths.join("\n") + "\n" + String(releaseNotes || "");
  const domains = Object.keys(IMPACT_DOMAINS).filter(domain => IMPACT_DOMAINS[domain].test(text));
  const adapterAreas = [];
  if (domains.some(domain => ["security", "transport"].includes(domain))) adapterAreas.push("execution.adapters");
  if (domains.some(domain => ["routing", "schema"].includes(domain))) adapterAreas.push("execution.adapters", "system.policy");
  if (domains.includes("runtime")) adapterAreas.push("execution.lifecycle", "platform.runtime");
  return Object.freeze({
    domains,
    adapterAreas: [...new Set(adapterAreas)],
    requiresManualAdapterReview: domains.length > 0
  });
}

const DOMAIN_CHECKS = Object.freeze({
  security: Object.freeze(["unit-tests", "compatibility-tests", "security-review"]),
  transport: Object.freeze(["compatibility-tests", "kernel-conformance"]),
  routing: Object.freeze(["compatibility-tests", "kernel-conformance"]),
  schema: Object.freeze(["unit-tests", "compatibility-tests"]),
  runtime: Object.freeze(["unit-tests", "kernel-conformance"])
});

export function buildKernelAdapterTestPlan(adapterImpact = {}) {
  const domains = Array.isArray(adapterImpact.domains) ? adapterImpact.domains : [];
  const checks = new Set(["unit-tests", "kernel-conformance"]);
  for (const domain of domains) {
    for (const check of DOMAIN_CHECKS[domain] || []) checks.add(check);
  }
  const adapterAreas = Array.isArray(adapterImpact.adapterAreas) ? adapterImpact.adapterAreas : [];
  return Object.freeze({
    domains: [...domains],
    adapterAreas: [...adapterAreas],
    checks: [...checks],
    manualReviewRequired: adapterImpact.requiresManualAdapterReview === true
  });
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
  const adapterImpact = analyzeKernelAdapterImpact(changedFiles, release.body || "");
  const testPlan = buildKernelAdapterTestPlan(adapterImpact);
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
    adapterImpact,
    testPlan,
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
