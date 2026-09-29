import { Kernels } from "./model.js";
import { getKernelUpstream } from "./kernel-registry.js";
import { getKernelSchema } from "./schema-registry.js";

function nonEmptyObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function finitePort(value) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}
function push(errors, message) {
  errors.push(message);
}

const MIHOMO_TYPES = new Set(["http","socks","shadowsocks","vmess","vless","trojan","hysteria","hysteria2","tuic","anytls","wireguard"]);
const SING_BOX_TYPES = new Set(["http","socks","shadowsocks","vmess","vless","trojan","hysteria","hysteria2","tuic","anytls","wireguard","block","selector","urltest"]);
const XRAY_TYPES = new Set(["http","socks","shadowsocks","vmess","vless","trojan","hysteria","wireguard","blackhole"]);

function validateEndpoint(item, label, errors) {
  if (!hasText(item.server)) push(errors, label + " requires server");
  if (!finitePort(item.server_port ?? item.port)) push(errors, label + " requires a valid server port");
}

function validateMihomoTerminalRouting(config, errors) {
  if (!Array.isArray(config.rules)) {
    push(errors, "Mihomo compiled configuration requires rules for fail-closed terminal routing");
    return;
  }
  const terminal = [...config.rules].reverse().find((rule) => typeof rule === "string" && rule.trim());
  if (!terminal || !/^MATCH,/i.test(terminal.trim())) {
    push(errors, "Mihomo compiled configuration requires a terminal MATCH rule");
    return;
  }
  if (/^MATCH,DIRECT$/i.test(terminal.trim())) {
    push(errors, "Mihomo compiled configuration forbids MATCH,DIRECT as terminal fallback");
  }
}

function validateSingBoxTerminalRouting(config, errors) {
  if (!nonEmptyObject(config.route)) {
    push(errors, "sing-box compiled configuration requires route for fail-closed terminal routing");
    return;
  }
  const final = config.route.final;
  if (!hasText(final)) {
    push(errors, "sing-box compiled configuration requires an explicit route.final");
    return;
  }
  const outbounds = Array.isArray(config.outbounds) ? config.outbounds : [];
  const target = outbounds.find((outbound) => outbound && outbound.tag === final);
  if (!target) {
    push(errors, "sing-box route.final references a missing outbound: " + final);
    return;
  }
  if (String(target.type).toLowerCase() === "direct") {
    push(errors, "sing-box compiled configuration forbids a direct route.final fallback");
  }
}

function validateXrayTerminalRouting(config, errors) {
  if (!nonEmptyObject(config.routing) || !Array.isArray(config.routing.rules)) {
    push(errors, "Xray compiled configuration requires routing.rules for fail-closed terminal routing");
    return;
  }
  const terminal = [...config.routing.rules].reverse().find((rule) => rule && typeof rule === "object");
  if (!terminal) {
    push(errors, "Xray compiled configuration requires a terminal routing rule");
    return;
  }
  const target = hasText(terminal.outboundTag) ? terminal.outboundTag : "";
  const balancer = hasText(terminal.balancerTag) ? terminal.balancerTag : "";
  if (!target && !balancer) {
    push(errors, "Xray compiled configuration requires terminal outboundTag or balancerTag");
    return;
  }
  if (target) {
    const outbounds = Array.isArray(config.outbounds) ? config.outbounds : [];
    const outbound = outbounds.find((item) => item && item.tag === target);
    if (!outbound) {
      push(errors, "Xray terminal outboundTag references a missing outbound: " + target);
      return;
    }
    if (String(outbound.protocol).toLowerCase() === "freedom") {
      push(errors, "Xray compiled configuration forbids freedom as terminal fallback");
    }
  }
}

function validateMihomoProxyProvider(provider, name, errors) {
  const label = "Mihomo proxy-provider[" + name + "]";
  if (!nonEmptyObject(provider)) {
    push(errors, label + " requires an object");
    return;
  }
  if (!hasText(provider.type)) {
    push(errors, label + " requires type");
    return;
  }
  if (!["http", "file", "inline"].includes(provider.type)) {
    push(errors, label + " uses unsupported provider type: " + provider.type);
    return;
  }
  if (provider.type === "http" && !hasText(provider.url)) {
    push(errors, label + " requires url for http provider");
  }
  if (provider.type === "file" && !hasText(provider.path)) {
    push(errors, label + " requires path for file provider");
  }
  if (provider.type === "inline" && provider.payload !== undefined && typeof provider.payload !== "string") {
    push(errors, label + " payload must be a string when provided");
  }
}

function validateMihomoProxy(proxy, index, errors) {
  const label = "Mihomo proxy[" + index + "]";
  if (!hasText(proxy.name)) push(errors, label + " requires name");
  if (!hasText(proxy.type)) push(errors, label + " requires type");
  if (!MIHOMO_TYPES.has(proxy.type)) push(errors, label + " uses unsupported proxy type: " + proxy.type);
  if (!hasText(proxy.server)) push(errors, label + " requires server");
  if (!finitePort(proxy.port)) push(errors, label + " requires valid port");
  if (["vmess","vless","tuic"].includes(proxy.type) && !hasText(proxy.uuid)) push(errors, label + " requires uuid");
  if (["trojan","hysteria2","anytls"].includes(proxy.type) && !hasText(proxy.password)) push(errors, label + " requires password");
  if (proxy.type === "shadowsocks" && (!hasText(proxy.cipher) || !hasText(proxy.password))) push(errors, label + " requires cipher and password");
  if (proxy.tls && proxy["reality-opts"] && proxy["reality-opts"]["public-key"] === undefined) push(errors, label + " Reality requires public-key");
}

function validateSingBoxOutbound(outbound, index, errors) {
  const label = "sing-box outbound[" + index + "]";
  if (!hasText(outbound.tag)) push(errors, label + " requires tag");
  if (!hasText(outbound.type)) push(errors, label + " requires type");
  if (!SING_BOX_TYPES.has(outbound.type)) {
    push(errors, label + " uses unsupported outbound type: " + outbound.type);
    return;
  }
  if (outbound.type === "block") return;
  if (outbound.type === "selector" || outbound.type === "urltest") {
    if (!Array.isArray(outbound.outbounds) || outbound.outbounds.length === 0) push(errors, label + " requires non-empty outbounds");
    return;
  }
  validateEndpoint(outbound, label, errors);
  if (["vmess","vless","tuic"].includes(outbound.type) && !hasText(outbound.uuid)) push(errors, label + " requires uuid");
  if (["trojan","shadowsocks","hysteria2","tuic","anytls"].includes(outbound.type) && !hasText(outbound.password)) push(errors, label + " requires password");
  if (outbound.type === "hysteria" && !hasText(outbound.auth) && !hasText(outbound.auth_str)) push(errors, label + " requires auth or auth_str");
  if (["hysteria","hysteria2","tuic"].includes(outbound.type) && !nonEmptyObject(outbound.tls)) push(errors, label + " requires TLS configuration");
  if (outbound.type === "shadowsocks" && !hasText(outbound.method)) push(errors, label + " requires method");
  if (outbound.tls?.reality?.enabled) {
    if (!hasText(outbound.tls.reality.public_key)) push(errors, label + " Reality requires public_key");
    if (outbound.tls.reality.short_id === undefined) push(errors, label + " Reality requires short_id");
    else if (!/^[0-9a-fA-F]{0,8}$/.test(String(outbound.tls.reality.short_id))) push(errors, label + " Reality short_id must be 0-8 hexadecimal digits");
  }
}

function validateXrayOutbound(outbound, index, errors) {
  const label = "Xray outbound[" + index + "]";
  if (!hasText(outbound.tag)) push(errors, label + " requires tag");
  if (!hasText(outbound.protocol)) push(errors, label + " requires protocol");
  if (!XRAY_TYPES.has(outbound.protocol)) {
    push(errors, label + " uses unsupported protocol: " + outbound.protocol);
    return;
  }
  if (outbound.protocol === "blackhole") return;
  const settings = nonEmptyObject(outbound.settings) ? outbound.settings : {};
  if (["vless","vmess","trojan","shadowsocks","hysteria","socks","http"].includes(outbound.protocol)) {
    if (!hasText(settings.address)) push(errors, label + " requires settings.address");
    if (!finitePort(settings.port)) push(errors, label + " requires settings.port");
  }
  if (["vless","vmess"].includes(outbound.protocol) && !hasText(settings.id)) push(errors, label + " requires settings.id");
  if (["trojan","shadowsocks"].includes(outbound.protocol) && !hasText(settings.password)) push(errors, label + " requires settings.password");
  if (outbound.protocol === "shadowsocks" && !hasText(settings.method)) push(errors, label + " requires settings.method");
  if (outbound.protocol === "hysteria" && settings.version !== 2) push(errors, label + " Hysteria requires version 2");
  if (outbound.streamSettings?.security === "reality") {
    const reality = nonEmptyObject(outbound.streamSettings.realitySettings) ? outbound.streamSettings.realitySettings : {};
    if (!hasText(reality.password)) push(errors, label + " Reality requires password (client public key)");
    if (!hasText(reality.fingerprint)) push(errors, label + " Reality requires fingerprint");
    if (reality.shortId !== undefined) {
      const shortId = String(reality.shortId);
      if (!/^[0-9a-fA-F]{0,16}$/.test(shortId) || shortId.length % 2 !== 0) push(errors, label + " Reality shortId must be an even-length hexadecimal string");
    }
  }
}

function validateRootSchema(config, schema, errors) {
  if (!nonEmptyObject(config)) {
    errors.push("compiled configuration must be an object");
    return;
  }
  const root = schema.root || {};
  for (const key of root.required || []) {
    if (!Array.isArray(config[key])) push(errors, schema.schemaId + " requires array: " + key);
  }
  if (Array.isArray(root.requiredAnyOf)) {
    const matched = root.requiredAnyOf.some((requirement) => {
      const key = typeof requirement === "string" ? requirement : requirement.key;
      const type = typeof requirement === "string" ? "array" : requirement.type;
      if (type === "object") return nonEmptyObject(config[key]);
      if (type === "array") return Array.isArray(config[key]);
      return config[key] !== undefined;
    });
    if (!matched) {
      const names = root.requiredAnyOf.map((requirement) => typeof requirement === "string" ? requirement : requirement.key);
      push(errors, schema.schemaId + " requires one of: " + names.join(", "));
    }
  }
}

export function validateCompiledConfig(config, kernel, expectedVersion = getKernelUpstream(kernel).stable) {
  const errors = [];
  let schema;
  try {
    schema = getKernelSchema(kernel, expectedVersion);
  } catch (error) {
    errors.push(error.message);
    return { ok: false, errors, kernel, version: expectedVersion, schemaId: null };
  }

  validateRootSchema(config, schema, errors);
  const upstream = getKernelUpstream(kernel);
  if (expectedVersion !== upstream.stable) errors.push("schema validator is pinned to " + upstream.name + " " + upstream.stable + "; requested " + expectedVersion);

  if (nonEmptyObject(config)) {
    if (kernel === Kernels.MIHOMO) {
      if (Array.isArray(config.proxies)) config.proxies.forEach((proxy, index) => validateMihomoProxy(proxy, index, errors));
      validateMihomoTerminalRouting(config, errors);
      if (nonEmptyObject(config["proxy-providers"])) {
        for (const [name, provider] of Object.entries(config["proxy-providers"])) {
          if (!hasText(name)) {
            push(errors, "Mihomo proxy-provider requires a non-empty name");
            continue;
          }
          validateMihomoProxyProvider(provider, name, errors);
        }
      }
    } else if (kernel === Kernels.SING_BOX) {
      if (Array.isArray(config.outbounds)) config.outbounds.forEach((outbound, index) => validateSingBoxOutbound(outbound, index, errors));
      validateSingBoxTerminalRouting(config, errors);
    } else if (kernel === Kernels.XRAY) {
      if (Array.isArray(config.outbounds)) config.outbounds.forEach((outbound, index) => validateXrayOutbound(outbound, index, errors));
      validateXrayTerminalRouting(config, errors);
    } else {
      errors.push("unsupported kernel: " + kernel);
    }
  }

  return { ok: errors.length === 0, errors, kernel, version: expectedVersion, schemaId: schema.schemaId };
}
