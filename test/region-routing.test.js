import test from "node:test";
import assert from "node:assert/strict";
import {
  REGION_SELECTION_MODES,
  RegionIds,
  buildRegionGroups,
  createRegionSelectionGroups,
  createServiceNodeBindings,
  resolveServiceNode,
  inferNodeRegion,
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

test("region detection does not confuse short country codes embedded in ordinary words", () => {
  assert.equal(inferNodeRegion({ name: "Canada Toronto 01" }), "ca");
  assert.equal(inferNodeRegion({ name: "Fast relay gateway" }), "unknown");
});

test("service node resolution uses normalized region member identity for health ranking", () => {
  const groups = createRegionSelectionGroups([
    { uuid: "node-a", name: "US West A" },
    { uuid: "node-b", name: "US West B" },
  ]);
  const bindings = createServiceNodeBindings({ ai: [{ id: "openai" }] }, groups, {
    overrides: { "service:ai:openai": { region: "us", mode: "auto" } },
  });
  const resolved = resolveServiceNode("service:ai:openai", bindings["service:ai:openai"], groups, {
    health: { "node-a": { available: true, latencyMs: 90 }, "node-b": { available: true, latencyMs: 30 } },
  });
  assert.equal(resolved.node.uuid, "node-b");
  assert.equal(resolved.candidates[0].nodeId, "node-b");
});

test("region catalog covers major countries and popular hosting regions", () => {
  const expected = [
    "cn", "hk", "mo", "tw", "jp", "kr", "sg", "my", "th", "vn", "id", "ph",
    "in", "au", "nz", "us", "ca", "mx", "br", "ar", "cl", "co", "pe",
    "gb", "ie", "fr", "de", "nl", "be", "ch", "at", "es", "pt", "it",
    "pl", "cz", "hu", "ro", "gr", "se", "no", "dk", "fi", "ua", "ru",
    "tr", "ae", "sa", "il", "eg", "za", "ng", "ke", "pk", "bd", "lk", "kz",
  ];
  for (const region of expected) assert.ok(RegionIds.includes(region), region);
});

test("expanded region aliases resolve without creating empty groups", () => {
  const samples = [
    ["Malaysia Kuala Lumpur", "my"],
    ["Thailand Bangkok", "th"],
    ["Vietnam Ho Chi Minh", "vn"],
    ["Indonesia Jakarta", "id"],
    ["Philippines Manila", "ph"],
    ["India Mumbai", "in"],
    ["New Zealand Auckland", "nz"],
    ["Mexico", "mx"],
    ["Brazil", "br"],
    ["Argentina", "ar"],
    ["Chile", "cl"],
    ["Colombia", "co"],
    ["Spain Madrid", "es"],
    ["Italy Milan", "it"],
    ["Switzerland Zurich", "ch"],
    ["Poland Warsaw", "pl"],
    ["Ukraine Kyiv", "ua"],
    ["Türkiye Istanbul", "tr"],
    ["United Arab Emirates Dubai", "ae"],
    ["Saudi Arabia Riyadh", "sa"],
    ["South Africa Johannesburg", "za"],
    ["Nigeria Lagos", "ng"],
    ["Kazakhstan Almaty", "kz"],
  ];

  for (const [name, region] of samples) {
    assert.equal(inferNodeRegion({ name }), region);
  }

  const groups = buildRegionGroups([
    { id: "jp-1", name: "Japan Tokyo" },
    { id: "ae-1", name: "United Arab Emirates Dubai" },
  ]);
  assert.deepEqual(Object.keys(groups).sort(), ["ae", "jp"]);
  assert.equal(groups.us, undefined);
});


test("explicit country metadata takes priority over ambiguous node-name text", () => {
  const region = inferNodeRegion({
    id: "node-1",
    name: "CA1-US",
    countryCode: "US",
  });
  assert.equal(region, "us");
});

test("manual service selection never silently falls back to automatic nodes", () => {
  const groups = createRegionSelectionGroups([
    { id: "us-1", name: "US 1" },
  ]);
  const bindings = createServiceNodeBindings(
    { ai: [{ id: "openai", domains: ["openai.com"], packages: [], processNames: [] }] },
    groups,
    { overrides: { "service:ai:openai": { mode: "manual", region: "us" } } },
  );

  assert.throws(
    () => resolveServiceNode("service:ai:openai", bindings["service:ai:openai"], groups),
    /manual service selection has no selected node/,
  );
});
