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

  if (!supportedProtocols.has(protocol)) unsupported.push("protocol:" + protocol);
  else capabilities.add(NodeCapabilities.TCP);

  if (node.udp === true) capabilities.add(NodeCapabilities.UDP);
  if (node.endpoint?.server) capabilities.add(NodeCapabilities.IPV4);
  if (node.tls?.enabled) capabilities.add(NodeCapabilities.TLS);
  if (node.tls?.reality?.enabled) capabilities.add(NodeCapabilities.REALITY);

  const transport = String(node.transport?.type || "").toLowerCase();
  if (transport === "ws") capabilities.add(NodeCapabilities.WEBSOCKET);
  if (transport === "grpc") capabilities.add(NodeCapabilities.GRPC);
  if (transport === "quic") capabilities.add(NodeCapabilities.QUIC);
  if (node.multiplex || node.mux || node.multiplex?.enabled) {
    capabilities.add(NodeCapabilities.MULTIPLEX);
  }

  return result(unsupported.length === 0, {
    kernel,
    protocol,
    supported: unsupported.length === 0,
    capabilities: [...capabilities].sort(),
    unsupported,
  }, unsupported.length ? "unsupported node capabilities: " + unsupported.join(", ") : null);
}
