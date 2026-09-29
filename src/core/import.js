import { sniff } from "./sniffer.js";
import { fetchSubscription, parseSubscriptionDocument, validateSubscriptionUrl } from "./subscription.js";
import { createUnifiedConfig, toUnifiedConfig } from "./unified-config.js";

function sourceText(input) {
  if (typeof input === "string") return input;
  if (input && typeof input === "object" && typeof input.content === "string") return input.content;
  return null;
}

function safeMetadata(input, detection, documentKind) {
  const metadata = {
    importKind: documentKind,
    detectedKernel: detection.kernel,
    candidates: [...detection.candidates],
    confidence: detection.confidence
  };
  if (input && typeof input === "object" && typeof input.name === "string") {
    metadata.sourceName = input.name.trim() || null;
  }
  return metadata;
}

export function importConfiguration(input, { maxNodes = null } = {}) {
  const text = sourceText(input);
  let detection;
  let document;

  if (text !== null) {
    detection = sniff(text);
    document = parseSubscriptionDocument(text);
  } else if (input && typeof input === "object" && !Array.isArray(input)) {
    detection = sniff(input);
    document = { kind: "structured", value: input };
  } else {
    throw new TypeError("configuration import must be text or object");
  }

  const metadata = safeMetadata(input, detection, document.kind);

  if (document.kind === "share-links") {
    const nodes = document.value;
    const config = createUnifiedConfig({
      sourceFormat: "share-links",
      kernel: detection.kernel,
      nodes: maxNodes === null ? nodes : nodes.slice(0, maxNodes),
      metadata
    });
    return {
      ok: true,
      status: detection.kernel ? "ready" : "kernel-selection-required",
      detection,
      config
    };
  }

  const config = toUnifiedConfig(document.value, {
    sourceFormat: detection.kind,
    kernel: detection.kernel,
    metadata
  });

  if (maxNodes !== null) {
    config.nodes = config.nodes.slice(0, maxNodes);
  }

  return {
    ok: true,
    status: detection.kernel ? "ready" : (detection.candidates.length ? "kernel-selection-required" : "unsupported-format"),
    detection,
    config
  };
}

export async function importConfigurationAsync(input, { maxNodes = null, fetcher = globalThis.fetch, maxBytes = 5 * 1024 * 1024 } = {}) {
  if (typeof input === "string" && /^https?:\/\//i.test(input.trim())) {
    const url = validateSubscriptionUrl(input.trim());
    const content = await fetchSubscription(url, { fetcher, maxBytes });
    return importConfiguration({ type: "file", name: url, content }, { maxNodes });
  }
  if (input && typeof input === "object" && input.type === "url" && typeof input.url === "string") {
    const url = validateSubscriptionUrl(input.url.trim());
    const content = await fetchSubscription(url, { fetcher, maxBytes });
    return importConfiguration({ type: "file", name: url, content }, { maxNodes });
  }
  return importConfiguration(input, { maxNodes });
}
