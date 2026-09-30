import test from "node:test";
import assert from "node:assert/strict";
import {
  LANDING_ENDPOINT_TYPES,
  WARP_TUNNEL_PROTOCOLS,
  createPlatformRoutingPlan,
  resolvePlatformLandingDecision,
  resolvePlatformRoutingDecision,
} from "../src/platform/index.js";

test("platform routing can select WARP only as the explicit landing exit", () => {
  const plan = createPlatformRoutingPlan({
    nodes: [
      { id: "us-node", name: "US Node", latencyMs: 20 },
    ],
    landingOptions: {
      warp: [{
        id: "warp-user-a",
        protocol: WARP_TUNNEL_PROTOCOLS.MASQUE,
        credentialRef: "secure:warp:user-a",
      }],
    },
  });

  const landing = resolvePlatformLandingDecision(plan, {
    preferredId: "warp-user-a",
    preferredType: LANDING_ENDPOINT_TYPES.WARP,
  });

  assert.equal(landing.target.type, "landing");
  assert.equal(landing.target.endpointType, LANDING_ENDPOINT_TYPES.WARP);
  assert.equal(landing.target.endpoint.execution.role, "landing-exit");
  assert.equal(landing.target.endpoint.execution.scope, "user");
});

test("WARP landing failure is fail-closed", () => {
  const plan = createPlatformRoutingPlan({
    nodes: [{ id: "us-node", name: "US Node", latencyMs: 20 }],
    landingOptions: {
      warp: [{ id: "warp-user-a", credentialRef: null }],
    },
  });

  const landing = resolvePlatformLandingDecision(plan, {
    preferredId: "warp-user-a",
    preferredType: LANDING_ENDPOINT_TYPES.WARP,
  });

  assert.equal(landing.target.type, "reject");
  assert.equal(landing.target.reason, "no-usable-landing-endpoint");
});

test("ordinary landing nodes remain available when WARP is absent", () => {
  const plan = createPlatformRoutingPlan({
    nodes: [{ id: "us-node", name: "US Node", latencyMs: 20 }],
  });

  const landing = resolvePlatformLandingDecision(plan, {
    preferredId: "us-node",
    preferredType: LANDING_ENDPOINT_TYPES.NODE,
  });

  assert.equal(landing.target.type, "landing");
  assert.equal(landing.target.endpointType, LANDING_ENDPOINT_TYPES.NODE);
});

test("explicit WARP landing is attached to a routed service without replacing the route decision", () => {
  const plan = createPlatformRoutingPlan({
    nodes: [
      { id: "us-node", name: "US Node", latencyMs: 20 },
    ],
    landingOptions: {
      warp: [{
        id: "warp-user-a",
        credentialRef: "secure:warp:user-a",
        protocol: WARP_TUNNEL_PROTOCOLS.MASQUE,
      }],
    },
  });

  const decision = resolvePlatformRoutingDecision(
    plan,
    { domain: "chatgpt.com" },
    { preferredLandingId: "warp-user-a", preferredLandingType: LANDING_ENDPOINT_TYPES.WARP },
  );

  assert.equal(decision.target.type, "node");
  assert.equal(decision.target.landing.endpointType, LANDING_ENDPOINT_TYPES.WARP);
  assert.equal(decision.target.landing.endpoint.execution.role, "landing-exit");
});


test("WARP lifecycle disable/delete never requires or exposes a new credential", async () => {
  const { provisionUserWarpLandingEndpoint, WARP_PROVISIONING_ACTIONS } = await import("../src/platform/index.js");

  const provisioner = {
    async provision(request) {
      return { id: "warp-user-a", name: "WARP", credentialRef: null, action: request.action };
    },
  };

  const disabled = await provisionUserWarpLandingEndpoint({
    userScopeId: "user-a",
    action: WARP_PROVISIONING_ACTIONS.DISABLE,
    provisioner,
  });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.lifecycle, WARP_PROVISIONING_ACTIONS.DISABLE);
  assert.equal(disabled.credentialRef, null);

  const deleted = await provisionUserWarpLandingEndpoint({
    userScopeId: "user-a",
    action: WARP_PROVISIONING_ACTIONS.DELETE,
    provisioner,
  });
  assert.equal(deleted.enabled, false);
  assert.equal(deleted.lifecycle, WARP_PROVISIONING_ACTIONS.DELETE);
  assert.equal(deleted.credentialRef, null);
});


test("WARP credential vault keeps secrets behind per-user references", async () => {
  const {
    storeWarpCredential,
    loadWarpCredential,
    removeWarpCredential,
  } = await import("../src/platform/index.js");

  const records = new Map();
  const vault = {
    async put(reference, credential) {
      records.set(reference.scope.id + ":" + reference.credentialId, credential);
    },
    async get(reference) {
      return records.get(reference.scope.id + ":" + reference.credentialId);
    },
    async remove(reference) {
      records.delete(reference.scope.id + ":" + reference.credentialId);
    },
  };

  const secret = { token: "user-secret" };
  const reference = await storeWarpCredential(vault, {
    userScopeId: "user-a",
    credentialId: "warp-credential-a",
    credential: secret,
  });

  assert.equal(reference.scope.id, "user-a");
  assert.equal(reference.credentialId, "warp-credential-a");
  assert.equal(reference.token, undefined);
  assert.equal(await loadWarpCredential(vault, reference), secret);

  await removeWarpCredential(vault, reference);
  assert.equal(await loadWarpCredential(vault, reference), undefined);
});
