/**
 * AngelaNexus platform flow identity.
 *
 * This is an observation/normalization model only. It does not select a
 * route, assign a priority, or delegate policy decisions to a kernel.
 * Missing evidence remains null instead of being guessed.
 */

function text(value) {
  if (value === undefined || value === null) return null;
  const result = String(value).trim();
  return result || null;
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function list(value) {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter(Boolean);
}

function normalizeDomain(value) {
  const result = text(value)?.toLowerCase().replace(/\.$/, "") || null;
  return result;
}

function normalizeIp(value) {
  return text(value)?.toLowerCase() || null;
}

function normalizeProtocol(value) {
  return text(value)?.toLowerCase() || null;
}

/**
 * Build a stable, evidence-preserving identity for one observed flow.
 * Values are only copied when supplied by the platform/OS/network observer.
 */
export function normalizeFlowIdentity(input = {}) {
  const app = input.app && typeof input.app === "object" ? input.app : {};
  const process = input.process && typeof input.process === "object" ? input.process : {};
  const network = input.network && typeof input.network === "object" ? input.network : {};
  const dns = input.dns && typeof input.dns === "object" ? input.dns : {};

  return {
    app: {
      packageId: text(app.packageId ?? input.packageId),
      bundleId: text(app.bundleId ?? input.bundleId),
      appId: text(app.appId ?? input.appId),
      uid: number(app.uid ?? input.uid),
      instanceId: text(app.instanceId ?? input.appInstanceId),
      evidence: list(app.evidence),
    },
    process: {
      name: text(process.name ?? input.processName),
      executable: text(process.executable ?? input.executable),
      pid: number(process.pid ?? input.pid),
      evidence: list(process.evidence),
    },
    destination: {
      domain: normalizeDomain(input.domain ?? network.domain),
      sni: normalizeDomain(input.sni ?? network.sni),
      ip: normalizeIp(input.ip ?? network.ip),
      port: number(input.port ?? network.port),
      protocol: normalizeProtocol(input.protocol ?? network.protocol),
      transport: normalizeProtocol(input.transport ?? network.transport),
    },
    dns: {
      query: normalizeDomain(input.dnsQuery ?? dns.query),
      answers: list(dns.answers).map(normalizeIp).filter(Boolean),
      resolver: normalizeIp(dns.resolver),
    },
    metadata: {
      source: text(input.source),
      observedAt: text(input.observedAt),
    },
  };
}

export function hasApplicationIdentity(identity) {
  return Boolean(identity?.app?.packageId || identity?.app?.bundleId || identity?.app?.appId || identity?.app?.uid !== null);
}

export function hasWebIdentity(identity) {
  return Boolean(identity?.destination?.domain || identity?.destination?.sni || identity?.dns?.query);
}
