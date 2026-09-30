export const WARP_CREDENTIAL_VAULT_VERSION = 1;

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
  if (!reference || reference.version !== WARP_CREDENTIAL_VAULT_VERSION ||
      !reference.scope || reference.scope.type !== "user") {
    throw new Error("invalid WARP credential reference");
  }
  return activeVault.get(reference);
}

export async function removeWarpCredential(vault, reference) {
  const activeVault = requiredVault(vault);
  if (!reference || reference.version !== WARP_CREDENTIAL_VAULT_VERSION ||
      !reference.scope || reference.scope.type !== "user") {
    throw new Error("invalid WARP credential reference");
  }
  await activeVault.remove(reference);
}
