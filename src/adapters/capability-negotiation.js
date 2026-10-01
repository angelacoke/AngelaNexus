export function normalizeCapabilities(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))];
}

export function missingCapabilities(available, required) {
  const availableSet = new Set(normalizeCapabilities(available));
  return normalizeCapabilities(required).filter((capability) => !availableSet.has(capability));
}

export function satisfiesCapabilities(available, required) {
  return missingCapabilities(available, required).length === 0;
}
