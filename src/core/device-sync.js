import { configIntegrityDigest } from "./config-integrity-portable.js";

export const DEVICE_SYNC_PROTOCOL_VERSION = 1;
export const PAIRING_SCHEME = "angelanexus://pair";

const SYNC_CATEGORIES = new Set([
  "profiles",
  "proxyPreferences",
  "routingPolicies",
  "securityPreferences",
  "gfwPreferences",
  "uiPreferences",
  "ruleOverrides",
  "importSources",
  "appPreferences"
]);

const FORBIDDEN_SYNC_KEYS = new Set([
  "secureCredentials",
  "deviceSecrets",
  "privateKey",
  "accessToken",
  "refreshToken",
  "vpnSessionState",
  "kernelRuntimeState"
]);

function requireNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(name + " is required");
  }
  return value.trim();
}

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(name + " must be a positive safe integer");
  }
  return value;
}

function assertNoForbiddenKeys(value, path = "payload") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, path + "[" + index + "]"));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_SYNC_KEYS.has(key)) {
      throw new TypeError("device-local secret/state cannot enter sync payload: " + path + "." + key);
    }
    assertNoForbiddenKeys(child, path + "." + key);
  }
}

function randomNonce(bytes = 16) {
  if (!Number.isInteger(bytes) || bytes < 16) throw new TypeError("nonce size is invalid");
  const source = globalThis.crypto;
  if (!source?.getRandomValues) {
    throw new Error("secure random source is unavailable");
  }
  const data = new Uint8Array(bytes);
  source.getRandomValues(data);
  return Array.from(data, (value) => value.toString(16).padStart(2, "0")).join("");
}

function encodeBase64Url(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return encodeURIComponent(btoa(binary));
}

function canonicalEventMaterial(event) {
  const { digest: _digest, ...material } = event;
  return material;
}

export function createDeviceIdentity({
  deviceId,
  publicKey,
  label = null,
  createdAt = new Date().toISOString()
} = {}) {
  const id = requireNonEmptyString(deviceId, "deviceId");
  const key = requireNonEmptyString(publicKey, "publicKey");
  if (label !== null && typeof label !== "string") throw new TypeError("device label must be a string");
  return Object.freeze({
    protocolVersion: DEVICE_SYNC_PROTOCOL_VERSION,
    deviceId: id,
    publicKey: key,
    label: label?.trim() || null,
    createdAt
  });
}

export function createPairingInvitation({
  networkId,
  inviter,
  expiresAt,
  permissions = ["config-sync"],
  nonce = null
} = {}) {
  const network = requireNonEmptyString(networkId, "networkId");
  if (!inviter?.deviceId || !inviter?.publicKey) {
    throw new TypeError("inviter device identity is required");
  }
  if (!Array.isArray(permissions) || permissions.length === 0) {
    throw new TypeError("pairing permissions are required");
  }
  const invitation = Object.freeze({
    protocolVersion: DEVICE_SYNC_PROTOCOL_VERSION,
    networkId: network,
    inviter: Object.freeze({
      deviceId: inviter.deviceId,
      publicKey: inviter.publicKey,
      label: inviter.label ?? null
    }),
    expiresAt: requireNonEmptyString(expiresAt, "expiresAt"),
    nonce: nonce || randomNonce(),
    permissions: Object.freeze([...new Set(permissions.map((item) => requireNonEmptyString(item, "permission")))])
  });
  return Object.freeze({
    ...invitation,
    qrPayload: PAIRING_SCHEME + "?v=" + DEVICE_SYNC_PROTOCOL_VERSION + "&data=" + encodeBase64Url(invitation)
  });
}

export function parsePairingInvitation(qrPayload, { now = new Date() } = {}) {
  const prefix = PAIRING_SCHEME + "?v=" + DEVICE_SYNC_PROTOCOL_VERSION + "&data=";
  if (typeof qrPayload !== "string" || !qrPayload.startsWith(prefix)) {
    throw new TypeError("unsupported AngelaNexus pairing payload");
  }
  const encoded = qrPayload.slice(prefix.length);
  if (!encoded) throw new TypeError("pairing payload data is empty");
  const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - encoded.length % 4) % 4));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const invitation = JSON.parse(new TextDecoder().decode(bytes));
  if (invitation.protocolVersion !== DEVICE_SYNC_PROTOCOL_VERSION) {
    throw new TypeError("unsupported pairing protocol version");
  }
  if (new Date(invitation.expiresAt).getTime() <= new Date(now).getTime()) {
    throw new Error("pairing invitation has expired");
  }
  return Object.freeze(invitation);
}

export function createSyncEvent({
  networkId,
  deviceId,
  sequence,
  category,
  operation = "set",
  path,
  value,
  timestamp = new Date().toISOString()
} = {}) {
  const event = {
    protocolVersion: DEVICE_SYNC_PROTOCOL_VERSION,
    eventId: requireNonEmptyString(deviceId, "deviceId") + ":" + requirePositiveInteger(sequence, "sequence"),
    networkId: requireNonEmptyString(networkId, "networkId"),
    originDeviceId: requireNonEmptyString(deviceId, "deviceId"),
    sequence: requirePositiveInteger(sequence, "sequence"),
    category: requireNonEmptyString(category, "category"),
    operation: requireNonEmptyString(operation, "operation"),
    path: requireNonEmptyString(path, "path"),
    value,
    timestamp
  };
  if (!SYNC_CATEGORIES.has(event.category)) {
    throw new TypeError("unsupported sync category: " + event.category);
  }
  if (event.operation === "set" && value === undefined) {
    throw new TypeError("set operation requires a value");
  }
  assertNoForbiddenKeys(event.value);
  event.digest = configIntegrityDigest(canonicalEventMaterial(event));
  return Object.freeze(event);
}

export function verifySyncEvent(event) {
  if (!event || typeof event !== "object") {
    return Object.freeze({ ok: false, code: "SYNC_EVENT_INVALID" });
  }
  if (!event.digest || typeof event.digest !== "string") {
    return Object.freeze({ ok: false, code: "SYNC_EVENT_DIGEST_MISSING" });
  }
  let expected;
  try {
    expected = configIntegrityDigest(canonicalEventMaterial(event));
  } catch {
    return Object.freeze({ ok: false, code: "SYNC_EVENT_INVALID" });
  }
  return Object.freeze({
    ok: expected === event.digest,
    code: expected === event.digest ? "SYNC_EVENT_VALID" : "SYNC_EVENT_INTEGRITY_MISMATCH",
    expected,
    actual: event.digest
  });
}

export function applySyncEvents(events, { networkId, initialState = {} } = {}) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array");
  const state = structuredClone(initialState);
  const seen = new Set();
  const accepted = [];
  for (const event of events) {
    if (networkId && event.networkId !== networkId) continue;
    const verification = verifySyncEvent(event);
    if (!verification.ok || seen.has(event.eventId)) continue;
    assertNoForbiddenKeys(event.value);
    seen.add(event.eventId);
    accepted.push(event);
  }
  accepted.sort((a, b) =>
    a.sequence - b.sequence ||
    a.originDeviceId.localeCompare(b.originDeviceId) ||
    a.eventId.localeCompare(b.eventId)
  );
  for (const event of accepted) {
    const parts = event.path.split(".").filter(Boolean);
    if (parts.length === 0) continue;
    let cursor = state;
    for (const part of parts.slice(0, -1)) {
      if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {};
      cursor = cursor[part];
    }
    const leaf = parts.at(-1);
    if (event.operation === "delete") delete cursor[leaf];
    else if (event.operation === "set") cursor[leaf] = structuredClone(event.value);
  }
  return Object.freeze({
    state: Object.freeze(state),
    acceptedEventIds: Object.freeze(accepted.map((event) => event.eventId))
  });
}
