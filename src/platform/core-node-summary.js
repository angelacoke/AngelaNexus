export const CORE_NODE_SUMMARY_LIMIT = 100;

const NAME_MAX_CHARS = 160;
const PROTOCOL_MAX_CHARS = 48;
const SERVER_MAX_CHARS = 253;

function displayText(value, maxChars) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.length > maxChars
    ? normalized.slice(0, maxChars - 1) + "…"
    : normalized;
}

/**
 * Project canonical Core nodes into a bounded, credential-free UI summary.
 * This is display data only; it must never be used to compile or select a route.
 */
export function projectCoreNodeSummaries(model) {
  const source = Array.isArray(model?.nodes) ? model.nodes : [];
  const nodeSummaries = source.slice(0, CORE_NODE_SUMMARY_LIMIT).map((node, index) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw new TypeError("Core canonical node summary source is invalid at index " + index);
    }

    const name = displayText(node.name, NAME_MAX_CHARS);
    if (!name) throw new TypeError("Core canonical node is missing a display name");

    const endpoint = node.endpoint && typeof node.endpoint === "object" && !Array.isArray(node.endpoint)
      ? node.endpoint
      : {};
    const rawPort = endpoint.port;
    const port = Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535
      ? rawPort
      : null;

    return {
      name,
      protocol: displayText(node.protocol, PROTOCOL_MAX_CHARS),
      server: displayText(endpoint.server, SERVER_MAX_CHARS),
      port,
    };
  });

  return {
    nodeSummaries,
    nodeSummariesTruncated: source.length > nodeSummaries.length,
  };
}
