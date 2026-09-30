import test from "node:test";
import assert from "node:assert/strict";
import {
  LANDING_ENDPOINT_TYPES,
  resolvePlatformChainPath,
  isWarpLandingPath,
} from "../src/platform/index.js";

const nodes = [
  { id: "entry-1", name: "Entry 1" },
  { id: "relay-1", name: "Relay 1" },
];

test("platform chain preserves entry and relay when WARP is the landing exit", () => {
  const path = resolvePlatformChainPath({
    nodes,
    entryId: "entry-1",
    relayId: "relay-1",
    landingId: "warp-user-a",
    landingType: LANDING_ENDPOINT_TYPES.WARP,
    landingEndpoints: [{
      id: "warp-user-a",
      type: LANDING_ENDPOINT_TYPES.WARP,
      credentialRef: "secure:warp:user-a",
    }],
  });

  assert.equal(path.type, "chain");
  assert.deepEqual(path.hops.map((hop) => hop.role || hop.type), [
    "entry",
    "relay",
    "landing-exit",
  ]);
  assert.equal(path.landing.type, LANDING_ENDPOINT_TYPES.WARP);
  assert.equal(isWarpLandingPath(path), true);
});

test("platform chain rejects an unavailable WARP landing instead of falling back", () => {
  const path = resolvePlatformChainPath({
    nodes,
    entryId: "entry-1",
    landingId: "warp-user-a",
    landingType: LANDING_ENDPOINT_TYPES.WARP,
    landingEndpoints: [{
      id: "warp-user-a",
      type: LANDING_ENDPOINT_TYPES.WARP,
      credentialRef: null,
    }],
  });

  assert.equal(path.type, "reject");
  assert.equal(path.reason, "no-usable-landing-endpoint");
});

test("platform chain keeps ordinary node landing behavior", () => {
  const path = resolvePlatformChainPath({
    nodes,
    entryId: "entry-1",
    landingId: "relay-1",
    landingType: LANDING_ENDPOINT_TYPES.NODE,
    landingEndpoints: [{
      id: "relay-1",
      type: LANDING_ENDPOINT_TYPES.NODE,
      node: nodes[1],
    }],
  });

  assert.equal(path.type, "chain");
  assert.equal(path.landing.type, LANDING_ENDPOINT_TYPES.NODE);
  assert.equal(isWarpLandingPath(path), false);
});

test("platform chain rejects missing entry before selecting a landing", () => {
  const path = resolvePlatformChainPath({
    nodes,
    entryId: "missing-entry",
    landingId: "warp-user-a",
    landingType: LANDING_ENDPOINT_TYPES.WARP,
    landingEndpoints: [{
      id: "warp-user-a",
      type: LANDING_ENDPOINT_TYPES.WARP,
      credentialRef: "secure:warp:user-a",
    }],
  });

  assert.equal(path.type, "reject");
  assert.equal(path.reason, "missing-entry-node");
});
