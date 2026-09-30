import { WARP_TUNNEL_PROTOCOLS } from "./landing-endpoints.js";

export const WARP_PROVISIONING_ACTIONS = Object.freeze({
  CREATE: "create",
  REGENERATE: "regenerate",
  DISABLE: "disable",
  DELETE: "delete",
});

function requiredScope(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("WARP user scope is required");
  }
  return value.trim();
}

function normalizeProtocol(value) {
  const protocol = String(value || WARP_TUNNEL_PROTOCOLS.MASQUE).toLowerCase();
  if (!Object.values(WARP_TUNNEL_PROTOCOLS).includes(protocol)) {
    throw new Error("unsupported WARP tunnel protocol: " + protocol);
  }
  return protocol;
}

function requiredProvisioner(provisioner) {
  if (!provisioner || typeof provisioner.provision !== "function") {
    throw new Error("WARP provisioner is required");
  }
  return provisioner;
}

export function createWarpProvisioningRequest({
  userScopeId,
  action = WARP_PROVISIONING_ACTIONS.CREATE,
  protocol = WARP_TUNNEL_PROTOCOLS.MASQUE,
} = {}) {
  const scope = requiredScope(userScopeId);
  if (!Object.values(WARP_PROVISIONING_ACTIONS).includes(action)) {
    throw new Error("unsupported WARP provisioning action: " + action);
  }

  return Object.freeze({
    action,
    protocol: normalizeProtocol(protocol),
    scope: Object.freeze({
      type: "user",
      id: scope,
    }),
  });
}

export async function provisionUserWarpLandingEndpoint({
  userScopeId,
  protocol = WARP_TUNNEL_PROTOCOLS.MASQUE,
  action = WARP_PROVISIONING_ACTIONS.CREATE,
  provisioner,
} = {}) {
  const request = createWarpProvisioningRequest({ userScopeId, protocol, action });
  const activeProvisioner = requiredProvisioner(provisioner);
  const registration = await activeProvisioner.provision(request);

  if (!registration || typeof registration !== "object") {
    throw new Error("WARP provisioner returned no registration");
  }
  if (typeof registration.id !== "string" || !registration.id.trim()) {
    throw new Error("WARP provisioner returned no registration id");
  }
  if (typeof registration.credentialRef !== "string" || !registration.credentialRef.trim()) {
    throw new Error("WARP provisioner returned no secure credential reference");
  }

  return Object.freeze({
    id: registration.id.trim(),
    type: "warp",
    name: typeof registration.name === "string" && registration.name.trim()
      ? registration.name.trim()
      : "WARP",
    protocol: request.protocol,
    enabled: true,
    credentialRef: registration.credentialRef.trim(),
    execution: Object.freeze({
      role: "landing-exit",
      scope: "user",
      countryAffinity: "not-guaranteed",
    }),
  });
}
