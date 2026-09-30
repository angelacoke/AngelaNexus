export const WARP_CREDENTIAL_VAULT_VERSION = 1;
const WARP_CREDENTIAL_REFERENCE_PREFIX = "warp-vault-v1:";

function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(field + " is required");
  }
  return value.trim();
}

function requiredVault(vault) {
  if (!vault || typeof vault.put !== "function" || typeof vault.get !== "function" ||
      typeof vault.remove !== "function") {
    throw new Error("WARP credential vault is required");
  }
  return vault;
}

export function createWarpCredentialReference({ userScopeId, credentialId } = {}) {
  return Object.freeze({
    version: WARP_CREDENTIAL_VAULT_VERSION,
    scope: Object.freeze({
      type: "user",
      id: requiredText(userScopeId, "WARP user scope"),
    }),
    credentialId: requiredText(credentialId, "WARP credential id"),
  });
}

export function serializeWarpCredentialReference(reference) {
  if (!reference || reference.version !== WARP_CREDENTIAL_VAULT_VERSION ||
      !reference.scope || reference.scope.type !== "user") {
    throw new Error("invalid WARP credential reference");
  }
  const scope = requiredText(reference.scope.id, "WARP user scope");
  const credentialId = requiredText(reference.credentialId, "WARP credential id");
  return WARP_CREDENTIAL_REFERENCE_PREFIX +
    encodeURIComponent(scope) + ":" + encodeURIComponent(credentialId);
}

export function parseWarpCredentialReference(serialized) {
  if (typeof serialized !== "string" ||
      !serialized.startsWith(WARP_CREDENTIAL_REFERENCE_PREFIX)) {
    throw new Error("invalid WARP credential reference");
  }

  const encoded = serialized.slice(WARP_CREDENTIAL_REFERENCE_PREFIX.length);
  const separator = encoded.indexOf(":");
  if (separator <= 0 || separator === encoded.length - 1) {
    throw new Error("invalid WARP credential reference");
  }

  let scope;
  let credentialId;
  try {
    scope = decodeURIComponent(encoded.slice(0, separator));
    credentialId = decodeURIComponent(encoded.slice(separator + 1));
  } catch {
    throw new Error("invalid WARP credential reference");
  }

  return createWarpCredentialReference({
    userScopeId: scope,
    credentialId,
  });
}

export async function storeWarpCredential(vault, {
  userScopeId,
  credentialId,
  credential,
} = {}) {
  const activeVault = requiredVault(vault);
  const reference = createWarpCredentialReference({ userScopeId, credentialId });
  if (credential === undefined || credential === null) {
    throw new Error("WARP credential is required");
  }
  await activeVault.put(reference, credential);
  return reference;
}

export async function loadWarpCredential(vault, reference) {
  const activeVault = requiredVault(vault);
  if (typeof reference === "string") {
    reference = parseWarpCredentialReference(reference);
  }
  if (!reference || reference.version !== WARP_CREDENTIAL_VAULT_VERSION ||
      !reference.scope || reference.scope.type !== "user") {
    throw new Error("invalid WARP credential reference");
  }
  return activeVault.get(reference);
}

export async function removeWarpCredential(vault, reference) {
  const activeVault = requiredVault(vault);
  if (typeof reference === "string") {
    reference = parseWarpCredentialReference(reference);
  }
  if (!reference || reference.version !== WARP_CREDENTIAL_VAULT_VERSION ||
      !reference.scope || reference.scope.type !== "user") {
    throw new Error("invalid WARP credential reference");
  }
  await activeVault.remove(reference);
}
