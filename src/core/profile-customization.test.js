import test from "node:test";
import assert from "node:assert/strict";
import {
  createProfileCustomization,
  createProfileFeatureState,
  resolveProfileGroups,
  resolveProfileChain,
} from "./profile-customization.js";

test("profile feature switches enable and disable individual groups", () => {
  const state = createProfileFeatureState({
    enabledGroupIds: ["auto", "global"],
    disabledGroupIds: ["global"],
  });
  const groups = resolveProfileGroups([
    { id: "auto", enabled: false },
    { id: "global", enabled: true },
    { id: "cn", enabled: true },
  ], state);

  assert.equal(groups.find((group) => group.id === "auto").enabled, true);
  assert.equal(groups.find((group) => group.id === "global").enabled, false);
  assert.equal(groups.find((group) => group.id === "cn").enabled, true);
});

test("chain is explicitly disabled by default", () => {
  assert.equal(resolveProfileChain({ id: "chain-a" }), null);
});

test("selected chain is returned only when explicitly enabled", () => {
  const chain = resolveProfileChain(
    { id: "chain-a", hops: ["a", "b"] },
    { chainEnabled: true, chainId: "chain-a" },
  );
  assert.equal(chain.enabled, true);
});

test("unknown group and chain selections are rejected", () => {
  assert.throws(() => createProfileCustomization({
    groups: [{ id: "auto" }],
    enabledGroupIds: ["missing"],
  }), /unknown policy group/);

  assert.throws(() => createProfileCustomization({
    chains: [{ id: "chain-a" }],
    chainEnabled: true,
    chainId: "missing",
  }), /unknown chain/);
});
