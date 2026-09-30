import test from "node:test";
import assert from "node:assert/strict";
import {
  REGION_SELECTION_MODES,
  buildRegionGroups,
  createRegionSelectionGroups,
  createServiceNodeBindings,
  resolveServiceNode,
} from "../src/platform/index.js";

const nodes = [
  { id: "us-1", name: "US West 01" },
  { id: "us-2", name: "US West 02" },
  { id: "jp-1", name: "JP Tokyo 01" },
  { id: "cn-1", name: "CN Shanghai 01" },
];

test("region groups are created only when nodes exist", () => {
  const groups = buildRegionGroups(nodes);
  assert.deepEqual(Object.keys(groups).sort(), ["cn", "jp", "us"]);
  assert.equal(groups.gb, undefined);
});

test("region groups support automatic ranking and manual selection", () => {
  const auto = createRegionSelectionGroups(nodes, {
    mode: REGION_SELECTION_MODES.AUTO,
    health: {
      "us-1": { available: true, latencyMs: 80 },
      "us-2": { available: true, latencyMs: 40 },
    },
  });
  assert.deepEqual(Object.keys(auto).sort(), ["cn", "jp", "us"]);
  assert.deepEqual(auto.us.selection.auto.candidateNodeIds, ["us-2", "us-1"]);
  assert.equal(auto.us.selection.auto.preferredNodeId, "us-2");
  assert.deepEqual(auto.us.selection.manual.selectedNodeIds, []);

  const manual = createRegionSelectionGroups(nodes, {
    mode: REGION_SELECTION_MODES.MANUAL,
    manualSelections: { us: ["us-1"] },
  });
  assert.deepEqual(Object.keys(manual).sort(), ["cn", "jp", "us"]);
  assert.equal(manual.us.selection.activeMode, REGION_SELECTION_MODES.MANUAL);
  assert.deepEqual(manual.us.selection.auto.candidateNodeIds, ["us-1", "us-2"]);
  assert.deepEqual(manual.us.selection.manual.selectedNodeIds, ["us-1"]);
  assert.equal(manual.jp.selection.manual.selectedNodeIds.length, 0);
});

test("service groups can inherit automatic region selection while individual services bind to explicit nodes", () => {
  const groups = createRegionSelectionGroups(nodes, { health: { "us-1": { latencyMs: 20 } } });
  const bindings = createServiceNodeBindings(
    { ai: [{ id: "openai" }, { id: "meta-ai" }] },
    groups,
    { overrides: { "service:ai:meta-ai": ["us-1"] } },
  );

  assert.equal(bindings["service:ai:openai"].selection.mode, REGION_SELECTION_MODES.AUTO);
  assert.equal(bindings["service:ai:meta-ai"].selection.mode, REGION_SELECTION_MODES.MANUAL);

  const resolved = resolveServiceNode(
    "service:ai:meta-ai",
    bindings["service:ai:meta-ai"],
    groups,
  );
  assert.equal(resolved.node.id, "us-1");
  assert.equal(resolved.region, "us");
});
