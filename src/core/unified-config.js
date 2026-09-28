import { Kernels, normalizeNodes } from "./model.js";

export const ConfigSections = Object.freeze({
  NODES: "nodes",
  SUBSCRIPTIONS: "subscriptions",
  GROUPS: "groups",
  ROUTING: "routing",
  DNS: "dns",
  SECURITY: "security",
  CHAINS: "chains",
  PLATFORM: "platform",
  NATIVE: "native"
});

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function isNonProxyOutbound(item) {
  if (!item || typeof item !== "object") return true;
  const type = String(item.type || "").toLowerCase();
  const protocol = String(item.protocol || "").toLowerCase();
  return [
    "selector", "urltest", "direct", "block", "dns", "loopback", "freedom", "blackhole"
  ].includes(type) || [
    "freedom", "blackhole", "dns", "loopback", "selector", "balancer"
  ].includes(protocol);
}

function extractNodes(input) {
  if (!input || typeof input !== "object") return [];
  if (Array.isArray(input.proxies)) return input.proxies;
  if (Array.isArray(input.nodes)) return input.nodes;
  if (Array.isArray(input.outbounds)) return input.outbounds.filter((item) => !isNonProxyOutbound(item));
  return [];
}

function extractGroups(input) {
  if (!input || typeof input !== "object") return [];
  if (Array.isArray(input.proxy_groups)) return clone(input.proxy_groups);
  if (Array.isArray(input["proxy-groups"])) return clone(input["proxy-groups"]);
  if (Array.isArray(input.outbounds)) {
    return input.outbounds.filter((item) => {
      if (!item || typeof item !== "object") return false;
      return ["selector", "urltest"].includes(String(item.type || "").toLowerCase());
    });
  }
  return [];
}

function extractRouting(input) {
  if (!input || typeof input !== "object") return {};
  if (input.route && typeof input.route === "object") return clone(input.route);
  if (input.routing && typeof input.routing === "object") return clone(input.routing);
  return {};
}

function extractDns(input) {
  if (!input || typeof input !== "object") return {};
  return input.dns && typeof input.dns === "object" ? clone(input.dns) : {};
}

function validKernel(kernel) {
  return Object.values(Kernels).includes(kernel) ? kernel : null;
}

export function createUnifiedConfig({
  sourceFormat = "unknown",
  kernel = null,
  nodes = [],
  subscriptions = [],
  groups = [],
  routing = {},
  dns = {},
  security = {},
  chains = [],
  platform = {},
  native = {},
  metadata = {}
} = {}) {
  return {
    version: 1,
    sourceFormat,
    kernel: validKernel(kernel),
    nodes: normalizeNodes(nodes),
    subscriptions: arrayOf(subscriptions).map(clone),
    groups: arrayOf(groups).map(clone),
    routing: clone(routing) || {},
    dns: clone(dns) || {},
    security: clone(security) || {},
    chains: arrayOf(chains).map(clone),
    platform: clone(platform) || {},
    native: clone(native) || {},
    metadata: clone(metadata) || {}
  };
}

export function toUnifiedConfig(input, {
  sourceFormat = "unknown",
  kernel = null,
  native = {},
  metadata = {}
} = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("unified configuration input must be an object");
  }

  const unified = createUnifiedConfig({
    sourceFormat,
    kernel,
    nodes: extractNodes(input),
    groups: extractGroups(input),
    routing: extractRouting(input),
    dns: extractDns(input),
    native,
    metadata
  });

  if (input.security && typeof input.security === "object") unified.security = clone(input.security);
  if (Array.isArray(input.subscriptions)) unified.subscriptions = input.subscriptions.map(clone);
  if (Array.isArray(input.chains)) unified.chains = input.chains.map(clone);
  if (input.platform && typeof input.platform === "object") unified.platform = clone(input.platform);

  return unified;
}

export function isUnifiedConfig(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value.version === 1 &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.groups) &&
    Array.isArray(value.subscriptions) &&
    Array.isArray(value.chains) &&
    value.routing &&
    typeof value.routing === "object" &&
    value.dns &&
    typeof value.dns === "object" &&
    value.native &&
    typeof value.native === "object"
  );
}

export function nodeCount(config) {
  return isUnifiedConfig(config) ? config.nodes.length : 0;
}
