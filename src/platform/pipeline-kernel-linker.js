import { driverFor } from "../kernel/driver-registry.js";

function clone(value) {
  return value && typeof value === "object" ? structuredClone(value) : value;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function endpointOf(value, field) {
  if (!value || typeof value !== "object") throw new TypeError(field + " is required");
  const host = text(value.host);
  if (!host) throw new Error(field + ".host is required");
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) {
    throw new RangeError(field + ".port is invalid");
  }
  return Object.freeze({ host, port: value.port });
}

function nodeName(hop) {
  return text(hop.node?.name) || text(hop.node?.id);
}

function ensureArray(config, key) {
  if (!Array.isArray(config[key])) config[key] = [];
  return config[key];
}

function uniqueTag(existing, prefix, hopId) {
  const base = "Nexus-" + prefix + "-" + hopId;
  let tag = base;
  let index = 2;
  while (existing.has(tag)) tag = base + "-" + index++;
  existing.add(tag);
  return tag;
}

function loopbackEndpoint(endpoint, field) {
  const host = text(endpoint.host);
  if (host === "127.0.0.1" || host === "::1" || host === "localhost") return endpoint;
  throw new Error(field + " must use a loopback address for an internal kernel link");
}

function linkEndpointFor(spec, index) {
  if (index === 0) return endpointOf(spec.inbound, "pipeline inbound");
  return loopbackEndpoint(spec.hops[index].listen, "pipeline hop " + spec.hops[index].id + " listen");
}

function compileMihomo(config, hop, inbound, upstream) {
  const proxies = ensureArray(config, "proxies");
  const existing = new Set(proxies.map((item) => item && item.name).filter(Boolean));
  const target = nodeName(hop);
  if (!target) throw new Error("pipeline hop " + hop.id + " requires a named node");
  const listener = {
    name: uniqueTag(existing, "PipelineIn", hop.id),
    type: "mixed",
    listen: inbound.host,
    port: inbound.port,
    udp: false,
    users: [],
    proxy: target,
  };
  const listeners = ensureArray(config, "listeners");
  listeners.push(listener);

  if (upstream) {
    const linkName = uniqueTag(existing, "PipelineLink", hop.id);
    proxies.push({
      name: linkName,
      type: "socks",
      server: upstream.host,
      port: upstream.port,
      udp: false,
    });
    const proxy = proxies.find((item) => item && item.name === target);
    if (!proxy) throw new Error("Mihomo pipeline node not found: " + target);
    proxy["dialer-proxy"] = linkName;
  }
  return config;
}

function compileSingBox(config, hop, inbound, upstream) {
  const outbounds = ensureArray(config, "outbounds");
  const existing = new Set(outbounds.map((item) => item && item.tag).filter(Boolean));
  const target = nodeName(hop);
  if (!target) throw new Error("pipeline hop " + hop.id + " requires a named node");

  const inboundTag = uniqueTag(existing, "PipelineIn", hop.id);
  const inbounds = ensureArray(config, "inbounds");
  inbounds.push({
    type: "mixed",
    tag: inboundTag,
    listen: inbound.host,
    listen_port: inbound.port,
  });

  if (!config.route || typeof config.route !== "object" || Array.isArray(config.route)) config.route = { rules: [] };
  if (!Array.isArray(config.route.rules)) config.route.rules = [];
  config.route.rules.unshift({
    inbound: [inboundTag],
    action: "route",
    outbound: target,
  });

  if (upstream) {
    const linkTag = uniqueTag(existing, "PipelineLink", hop.id);
    outbounds.push({
      type: "socks",
      tag: linkTag,
      server: upstream.host,
      server_port: upstream.port,
    });
    const outbound = outbounds.find((item) => item && item.tag === target);
    if (!outbound) throw new Error("sing-box pipeline node not found: " + target);
    outbound.detour = linkTag;
  }
  return config;
}

function compileXray(config, hop, inbound, upstream) {
  const outbounds = ensureArray(config, "outbounds");
  const existing = new Set(outbounds.map((item) => item && item.tag).filter(Boolean));
  const target = nodeName(hop);
  if (!target) throw new Error("pipeline hop " + hop.id + " requires a named node");

  const inboundTag = uniqueTag(existing, "PipelineIn", hop.id);
  const inbounds = ensureArray(config, "inbounds");
  inbounds.push({
    listen: inbound.host,
    port: inbound.port,
    protocol: "socks",
    tag: inboundTag,
    settings: { udp: false },
  });

  if (!config.routing || typeof config.routing !== "object" || Array.isArray(config.routing)) config.routing = { rules: [] };
  if (!Array.isArray(config.routing.rules)) config.routing.rules = [];
  config.routing.rules.unshift({
    type: "field",
    inboundTag: [inboundTag],
    outboundTag: target,
  });

  if (upstream) {
    const linkTag = uniqueTag(existing, "PipelineLink", hop.id);
    outbounds.push({
      protocol: "socks",
      tag: linkTag,
      settings: {
        address: upstream.host,
        port: upstream.port,
      },
    });
    const outbound = outbounds.find((item) => item && item.tag === target);
    if (!outbound) throw new Error("Xray pipeline node not found: " + target);
    outbound.streamSettings = clone(outbound.streamSettings) || {};
    outbound.streamSettings.sockopt = clone(outbound.streamSettings.sockopt) || {};
    outbound.streamSettings.sockopt.dialerProxy = linkTag;
  }
  return config;
}

function kernelCompiler(kernel) {
  if (kernel === "mihomo") return compileMihomo;
  if (kernel === "sing-box") return compileSingBox;
  if (kernel === "xray") return compileXray;
  throw new Error("unsupported kernel pipeline linker: " + kernel);
}

export function compileLinkedPipeline(spec, { drivers } = {}) {
  if (!spec || !Array.isArray(spec.hops) || spec.hops.length === 0) {
    throw new TypeError("linked pipeline requires a pipeline spec");
  }
  const inbound = endpointOf(spec.inbound, "pipeline inbound");
  const driverLookup = typeof drivers === "function"
    ? drivers
    : (kernel) => (drivers && drivers[kernel]) || driverFor(kernel);

  const compiled = [];
  for (let index = 0; index < spec.hops.length; index += 1) {
    const hop = spec.hops[index];
    const driver = driverLookup(hop.kernel);
    if (!driver || typeof driver.compileNode !== "function") {
      throw new Error("kernel driver is unavailable: " + hop.kernel);
    }
    const currentInbound = linkEndpointFor(spec, index);
    const upstream = index === 0 ? null : loopbackEndpoint(spec.hops[index - 1].listen, "pipeline upstream");
    const config = clone(driver.compileNode(hop.node, { security: spec.security }));
    const compiler = kernelCompiler(hop.kernel);
    compiled.push(Object.freeze({
      hopId: hop.id,
      kernel: hop.kernel,
      inbound: currentInbound,
      upstream,
      config: Object.freeze(compiler(config, hop, currentInbound, upstream)),
    }));
  }

  return Object.freeze({
    version: 1,
    pipelineId: spec.id,
    transport: "tcp",
    failClosed: spec.security?.failClosed !== false,
    hops: Object.freeze(compiled),
  });
}
