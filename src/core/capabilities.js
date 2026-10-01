import { Kernels, NodeProtocols, result } from "./model.js";

export const NodeCapabilities = Object.freeze({
  TCP: "tcp",
  UDP: "udp",
  IPV4: "ipv4",
  IPV6: "ipv6",
  TLS: "tls",
  REALITY: "reality",
  WEBSOCKET: "websocket",
  GRPC: "grpc",
  QUIC: "quic",
  MULTIPLEX: "multiplex",
  CHAIN: "chain",
});

const protocolSupport = Object.freeze({
  [Kernels.MIHOMO]: new Set(Object.values(NodeProtocols)),
  [Kernels.SING_BOX]: new Set(Object.values(NodeProtocols).filter((protocol) => protocol !== NodeProtocols.WIREGUARD)),
  [Kernels.XRAY]: new Set([
    "http",
    "socks",
    "shadowsocks",
    "vmess",
    "vless",
    "trojan",
    "hysteria",
    "wireguard",
  ]),
});

const QUIC_PROTOCOLS = new Set([
  NodeProtocols.HYSTERIA,
  NodeProtocols.HYSTERIA2,
  NodeProtocols.TUIC,
]);

const UDP_NATIVE_PROTOCOLS = new Set([
  NodeProtocols.HYSTERIA,
  NodeProtocols.HYSTERIA2,
  NodeProtocols.TUIC,
  NodeProtocols.WIREGUARD,
]);

function literalAddressFamily(value) {
  const address = typeof value === "string" ? value.trim() : "";
  if (!address) return null;
  if (/^\\d{1,3}(?:\\.\\d{1,3}){3}$/.test(address)) return "ipv4";
  if (address.includes(":") && /^[0-9a-f:.]+$/i.test(address)) return "ipv6";
  return null;
}

function explicitIpVersion(node) {
  const value = node?.["ip-version"] ?? node?.ipVersion ?? node?.ip_version;
  const normalized = String(value || "").toLowerCase();
  if (normalized === "4" || normalized === "ipv4" || normalized === "ipv4-prefer") return "ipv4";
  if (normalized === "6" || normalized === "ipv6" || normalized === "ipv6-prefer") return "ipv6";
  return null;
}

function hasChainConfiguration(node) {
  return Boolean(
    node?.chain
    || node?.dialerProxy
    || node?.["dialer-proxy"]
    || node?.detour
  );
}

export function evaluateNodeCapabilities(node, kernel) {
  if (!Object.values(Kernels).includes(kernel)) {
    return result(false, {}, "unsupported kernel: " + kernel);
  }
  if (!node || typeof node !== "object") {
    return result(false, {}, "node is required");
  }

  const protocol = String(node.protocol || "").toLowerCase();
  if (!protocol) return result(false, {}, "node protocol is required");

  const capabilities = new Set();
  const unsupported = [];
  const supportedProtocols = protocolSupport[kernel];

  if (!supportedProtocols.has(protocol)) {
    unsupported.push("protocol:" + protocol);
  } else {
    capabilities.add(NodeCapabilities.TCP);
  }

  if (node.udp === true || UDP_NATIVE_PROTOCOLS.has(protocol)) {
    capabilities.add(NodeCapabilities.UDP);
  }

  const family = literalAddressFamily(node.endpoint?.server || node.server || node.address);
  const configuredFamily = explicitIpVersion(node);
  if (family) capabilities.add(family === "ipv4" ? NodeCapabilities.IPV4 : NodeCapabilities.IPV6);
  else if (configuredFamily === "ipv4") capabilities.add(NodeCapabilities.IPV4);
  else if (configuredFamily === "ipv6") capabilities.add(NodeCapabilities.IPV6);

  if (node.tls?.enabled || node.tls === true) capabilities.add(NodeCapabilities.TLS);
  if (node.tls?.reality?.enabled || node.reality === true || node["reality-opts"]) {
    capabilities.add(NodeCapabilities.REALITY);
  }

  const transport = String(node.transport?.type || node.network || "").toLowerCase();
  if (transport === "ws") capabilities.add(NodeCapabilities.WEBSOCKET);
  if (transport === "grpc") capabilities.add(NodeCapabilities.GRPC);
  if (transport === "quic" || QUIC_PROTOCOLS.has(protocol)) capabilities.add(NodeCapabilities.QUIC);

  if (node.multiplex?.enabled === true || node.multiplex === true || node.mux?.enabled === true || node.mux === true) {
    capabilities.add(NodeCapabilities.MULTIPLEX);
  }

  if (hasChainConfiguration(node)) capabilities.add(NodeCapabilities.CHAIN);

  if (
    kernel === Kernels.MIHOMO
    && protocol === NodeProtocols.ANYTLS
    && (node.tls?.reality?.enabled || node.reality === true || node["reality-opts"])
  ) {
    unsupported.push("combination:anytls+reality");
  }

  return result(unsupported.length === 0, {
    kernel,
    protocol,
    supported: unsupported.length === 0,
    capabilities: [...capabilities].sort(),
    unsupported,
  }, unsupported.length ? "unsupported node capabilities: " + unsupported.join(", ") : null);
}
