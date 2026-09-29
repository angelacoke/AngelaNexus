import { sniff } from "./sniffer.js";
import { classifyImportSource, fetchSubscription, parseSubscription, parseSubscriptionDocument } from "./subscription.js";
import { toUnifiedConfig } from "./unified-config.js";
import { normalizeNodeConfig } from "./config.js";
import { Kernels } from "./model.js";
import { createDecisionPrompt } from "./decision-registry.js";
import { createSensitiveSourceCarrier } from "./sensitive-source.js";

function validateKernel(kernel) {
  if (kernel === null || kernel === undefined) return null;
  if (!Object.values(Kernels).includes(kernel)) throw new Error("unsupported kernel: " + kernel);
  return kernel;
}

function promptFor(detected, selected, explicit) {
  if (explicit) return { required: false, title: "Kernel binding", message: "The selected kernel will be used for this import.", reason: "user-selected" };
  if (selected) return { required: false, title: "Kernel detected", message: "AngelaNexus detected " + selected + " from the input format and bound it automatically.", reason: detected.confidence };
  return { required: false, title: "Native runtime resolution", message: detected.candidates.length ? "AngelaNexus recognized the input and will resolve a compatible native runtime automatically." : "Nexus could not establish a native runtime yet; the original input will be preserved for later resolution.", reason: detected.confidence, options: detected.candidates.slice() };
}

export function inspectImport(input, { kernel = null } = {}) {
  const detected = sniff(input);
  const explicit = kernel !== null && kernel !== undefined;
  const selected = validateKernel(kernel) || detected.kernel;
  if (explicit && detected.kernel && detected.kernel !== selected) throw new Error("selected kernel is incompatible with detected format");
  const prompt = promptFor(detected, selected, explicit);
  const decision = createDecisionPrompt("detectKernelCompatibility", detected.candidates.slice());
  return { detection: detected, binding: { kernel: selected, mode: explicit ? "explicit" : "automatic", candidates: detected.candidates.slice(), requiresConfirmation: prompt.required, prompt, decision: { ...decision, requiresUserChoice: prompt.required } } };
}

export async function importSource(input, { kernel = null, maxNodes = null, fetcher = globalThis.fetch } = {}) {
  const source = classifyImportSource(input);
  if (source.type === "url") return importConfig(await fetchSubscription(source.url, { fetcher }), { kernel, maxNodes });
  if (source.type === "file" || source.type === "text") return importConfig(source.content, { kernel, maxNodes });
  return importConfig(source.value, { kernel, maxNodes });
}

function buildUnifiedInput(input, sourceDocument, nodes) {
  const value = sourceDocument ? sourceDocument.value : input;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { nodes };
  const safe = { ...value };
  delete safe.proxies;
  delete safe.nodes;
  if (Array.isArray(safe.outbounds)) {
    const groups = safe.outbounds
      .filter((item) => item && typeof item === "object" && ["selector", "urltest"].includes(String(item.type || "").toLowerCase()))
      .map((item) => {
        const group = { ...item };
        if (group.name === undefined && group.tag !== undefined) group.name = group.tag;
        return group;
      });
    delete safe.outbounds;
    if (groups.length) safe.proxy_groups = groups;
  } else {
    delete safe.outbounds;
  }
  return { ...safe, nodes };
}

export function importConfig(input, { kernel = null, maxNodes = null } = {}) {
  const inspection = inspectImport(input, { kernel });
  const sourceVault = createSensitiveSourceCarrier(input);
  let nodes;
  let sourceDocument = null;
  if (typeof input === "string") {
    sourceDocument = parseSubscriptionDocument(input);
    nodes = parseSubscription(input, { maxNodes });
  } else if (input && typeof input === "object" && !Array.isArray(input)) {
    const candidates = Array.isArray(input.proxies) ? input.proxies : Array.isArray(input.nodes) ? input.nodes : Array.isArray(input.outbounds) ? input.outbounds.filter((item) => {
      if (!item || typeof item !== "object") return false;
      const type = String(item.type || "").toLowerCase();
      const protocol = String(item.protocol || "").toLowerCase();
      return !["selector", "urltest", "direct", "block", "dns", "loopback", "freedom", "blackhole"].includes(type) && !["freedom", "blackhole", "dns", "loopback", "selector", "balancer"].includes(protocol);
    }) : [];
    nodes = normalizeNodeConfig(candidates, maxNodes);
  } else throw new TypeError("import input must be text or object");

  const unifiedInput = sourceDocument && sourceDocument.kind === "share-links" ? { nodes } : buildUnifiedInput(input, sourceDocument, nodes);
  const unifiedConfig = toUnifiedConfig(unifiedInput, {
    sourceFormat: inspection.detection.kind,
    kernel: inspection.binding.kernel,
    metadata: { bindingMode: inspection.binding.mode, detectionConfidence: inspection.detection.confidence, runtimeCandidates: inspection.binding.candidates, nativeInput: true, sourceDigest: sourceVault.digest, credentialBearing: sourceVault.credentialBearing },
    native: { format: inspection.detection.kind, protocol: inspection.detection.protocol || null, runtimeCandidates: inspection.binding.candidates, source: { version: sourceVault.version, digest: sourceVault.digest, credentialBearing: sourceVault.credentialBearing } }
  });

  const result = { ...inspection, model: { nodes, nodeCount: nodes.length, nodeLimit: maxNodes, unifiedConfig } };
  Object.defineProperty(result, "sourceVault", { value: sourceVault, enumerable: false, configurable: false, writable: false });
  return Object.freeze(result);
}
