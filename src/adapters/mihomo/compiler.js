import { validateChain } from "../../core/chain.js";
import { Kernels } from "../../core/model.js";
import { compileRoutingPolicy } from "../../core/routing-compiler.js";
import { compileDnsConfig } from "../../core/dns.js";

function clone(value) { return value && typeof value === "object" ? structuredClone(value) : value; }
function requireProxy(config, id) {
  const proxy = (config.proxies || []).find((p) => p && p.name === id);
  if (!proxy) throw new Error("Mihomo proxy not found: " + id);
  return clone(proxy);
}
function compileNode(node) {
  const source = clone(node) || {};
  let type = String(source.protocol || source.type || "").toLowerCase();
  if (type === "socks5") type = "socks";
  const output = { name: source.name || source.id, type, server: source.endpoint?.server || source.server || source.address, port: Number(source.endpoint?.port || source.port || source.server_port) };
  const auth = source.auth || source;
  if (auth.uuid && ["vless","vmess","tuic"].includes(type)) output.uuid = auth.uuid;
  if (auth.username) output.username = auth.username;
  if (auth.password) output.password = auth.password;
  if (source.method !== undefined) output.cipher = clone(source.method);
  if (source.cipher !== undefined) output.cipher = clone(source.cipher);
  if (source.tls) {
    output.tls = Boolean(source.tls.enabled || source.tls.reality?.enabled);
    if (source.tls.serverName) output.sni = source.tls.serverName;
    if (source.tls.insecure) output["skip-cert-verify"] = true;
    if (source.tls.alpn?.length) output.alpn = [...source.tls.alpn];
    if (source.tls.fingerprint) output["client-fingerprint"] = source.tls.fingerprint;
    if (source.tls.reality?.enabled) output["reality-opts"] = { "public-key": source.tls.reality.publicKey, "short-id": source.tls.reality.shortId };
  }
  if (source.transport?.type) {
    output.network = source.transport.type;
    if (source.transport.type === "ws") {
      output["ws-opts"] = { path: source.transport.path || "/" };
      if (source.transport.headers) output["ws-opts"].headers = clone(source.transport.headers);
    } else if (source.transport.type === "grpc") {
      output["grpc-opts"] = { "grpc-service-name": source.transport.serviceName || "" };
    } else if (source.transport.type === "http" || source.transport.type === "h2") {
      output["http-opts"] = {};
      if (source.transport.path) output["http-opts"].path = source.transport.path;
      if (source.transport.headers) output["http-opts"].headers = clone(source.transport.headers);
    } else if (source.transport.type === "xhttp") output["xhttp-opts"] = clone(source.transport.raw || {});
  }
  if (!output.name || !output.type || !output.server || !Number.isFinite(output.port)) throw new Error("Mihomo node requires name, type, server and port: " + (source.id || "unknown"));
  if (source.udp !== undefined && source.udp !== null) output.udp = Boolean(source.udp);
  if (source.flow !== undefined) output.flow = clone(source.flow);
  if (auth.flow !== undefined) output.flow = clone(auth.flow);
  if (auth.alterId !== undefined && auth.alterId !== null) output.alterId = clone(auth.alterId);
  if (source.packet_encoding !== undefined) output["packet-encoding"] = clone(source.packet_encoding);
  for (const key of ["up","down","ports","hop-interval","bbr-profile","obfs","obfs-password","congestion-control","udp-relay-mode","udp-over-stream","zero-rtt-handshake","heartbeat","idle-session-check-interval","idle-session-timeout","min-idle-session","client-metadata","private-key","private_key","peers","interface-name","ip-version"]) if (source[key] !== undefined) output[key] = clone(source[key]);
  if (source.privateKey !== undefined && output["private-key"] === undefined) output["private-key"] = clone(source.privateKey);
  return output;
}
function applySecurityRules(output, config) {
  const security = config.security || {};
  const rules = [];
  if (security.ipv6LeakBlackhole === true) rules.push("IP-CIDR6,::/0,REJECT");
  if (security.blockWebRTC3478 === true) rules.push("DST-PORT,3478,REJECT");
  const existing = output.rules || [];
  const terminalIndex = existing.findIndex((rule) => typeof rule === "string" && rule.indexOf("MATCH,") === 0);
  if (terminalIndex >= 0) {
    output.rules = rules.concat(existing);
  } else {
    output.rules = rules.concat(existing);
  }
  return output;
}

export function compileMihomoConfig(config) {
  const output = { proxies: (config.nodes || []).map(compileNode) };
  if (Array.isArray(config.groups) && config.groups.length) output["proxy-groups"] = clone(config.groups);
  output.dns = compileDnsConfig(config, Kernels.MIHOMO);
  if (config.routing && Object.keys(config.routing).length) {
    output.rules = compileRoutingPolicy(config.routing, Kernels.MIHOMO);
    const fallback = config.routing.defaultAction;
    if (fallback) {
      if (fallback.type === "route") output.rules.push("MATCH," + fallback.target);
      else if (fallback.type === "chain") output.rules.push("MATCH," + fallback.target);
      else if (fallback.type === "reject") output.rules.push("MATCH,REJECT");
      else throw new Error("unsupported Mihomo default routing action: " + fallback.type);
    } else if (config.security?.failClosed !== false) {
      output.rules.push("MATCH,REJECT");
    }
    applySecurityRules(output, config);
  } else if (config.security?.failClosed !== false) {
    output.rules = ["MATCH,REJECT"];
    applySecurityRules(output, config);
  }
  return output;
}
export function compileMihomoChain(config, chain) {
  const validation = validateChain(chain.mode, chain.hops);
  if (!validation.ok) throw new Error(validation.error);
  const output = clone(config) || {};
  output.proxies = Array.isArray(output.proxies) ? output.proxies.map(clone) : [];
  for (let i = 1; i < chain.hops.length; i++) {
    const current = chain.hops[i], dialer = chain.hops[i - 1];
    const proxy = requireProxy(output, current.name || current.id);
    proxy["dialer-proxy"] = dialer.name || dialer.id;
    const index = output.proxies.findIndex((p) => p && p.name === (current.name || current.id));
    if (index < 0) throw new Error("Mihomo proxy not found: " + (current.name || current.id));
    output.proxies[index] = proxy;
  }
  return output;
}
