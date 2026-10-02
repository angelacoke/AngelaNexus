export const PATH_REGISTRY_VERSION = 1;

export const PathRegistryStates = Object.freeze({
  ACTIVE: "active",
  DISABLED: "disabled",
  QUARANTINED: "quarantined",
});

const VALID_STATES = Object.freeze(Object.values(PathRegistryStates));

function normalizePath(path) {
  if (!path || typeof path !== "object") return null;
  const id = typeof path.id === "string" && path.id.trim() ? path.id.trim() : null;
  const type = typeof path.type === "string" && path.type.trim() ? path.type.trim() : null;
  if (!id || !type) return null;

  const state = VALID_STATES.includes(path.state) ? path.state : PathRegistryStates.ACTIVE;
  return Object.freeze({
    ...path,
    id,
    type,
    state,
    userAllowed: path.userAllowed !== false,
    verified: path.verified === true,
    securityHealthy: path.securityHealthy === true,
  });
}

function matches(path, query = {}) {
  if (query.type && path.type !== query.type) return false;
  if (query.state && path.state !== query.state) return false;
  if (query.verified === true && path.verified !== true) return false;
  if (query.securityHealthy === true && path.securityHealthy !== true) return false;
  if (query.userAllowed === true && path.userAllowed !== true) return false;
  return true;
}

export function createPathRegistry({ maxEntries = 128 } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new TypeError("maxEntries must be a positive integer");
  }

  const entries = new Map();

  function register(path) {
    const normalized = normalizePath(path);
    if (!normalized) return Object.freeze({ ok: false, reason: "invalid-path" });

    entries.delete(normalized.id);
    entries.set(normalized.id, normalized);

    while (entries.size > maxEntries) {
      entries.delete(entries.keys().next().value);
    }

    return Object.freeze({ ok: true, path: normalized });
  }

  function update(id, patch = {}) {
    const current = entries.get(id);
    if (!current) return Object.freeze({ ok: false, reason: "path-not-found" });
    return register({ ...current, ...patch, id });
  }

  function remove(id) {
    const existed = entries.has(id);
    if (existed) entries.delete(id);
    return Object.freeze({ ok: existed, reason: existed ? null : "path-not-found" });
  }

  function get(id) {
    return entries.get(id) || null;
  }

  function list(query = {}) {
    return Object.freeze([...entries.values()].filter((path) => matches(path, query)));
  }

  function snapshot() {
    return Object.freeze({
      version: PATH_REGISTRY_VERSION,
      size: entries.size,
      paths: Object.freeze([...entries.values()]),
    });
  }

  return Object.freeze({
    version: PATH_REGISTRY_VERSION,
    register,
    update,
    remove,
    get,
    list,
    snapshot,
  });
}
