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
