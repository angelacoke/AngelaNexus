import { normalizeNode } from "../core/model.js";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function createNodeProfile(input, index = 0) {
  const node = normalizeNode(input, index);
  if (!node) throw new TypeError("node profile requires a valid node");
  if (!node.protocol) throw new Error("node profile requires a protocol");
  if (!node.endpoint?.server || !Number.isFinite(node.endpoint?.port)) {
    throw new Error("node profile requires a valid remote endpoint");
  }
  return Object.freeze({
    version: 1,
    id: text(node.id),
    name: text(node.name) || text(node.id),
    protocol: node.protocol,
    endpoint: Object.freeze({
      server: node.endpoint.server,
      port: node.endpoint.port,
    }),
    auth: Object.freeze(structuredClone(node.auth || {})),
    tls: node.tls ? Object.freeze(structuredClone(node.tls)) : null,
    transport: node.transport ? Object.freeze(structuredClone(node.transport)) : null,
    udp: node.udp,
    source: Object.freeze(structuredClone(node)),
  });
}

export function createNodeProfiles(nodes = []) {
  if (!Array.isArray(nodes)) throw new TypeError("node profiles require an array");
  return Object.freeze(nodes.map((node, index) => createNodeProfile(node, index)));
}
