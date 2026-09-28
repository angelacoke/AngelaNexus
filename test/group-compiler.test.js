import test from "node:test";
import assert from "node:assert/strict";
import { compileUnifiedConfig } from "../src/core/config-compiler.js";
import { Kernels } from "../src/core/model.js";

test("compiles unified groups to Mihomo and rewrites route targets", () => {
  const result = compileUnifiedConfig({
    kernel: Kernels.MIHOMO,
    nodes: [
      { id: "us-1", protocol: "socks", server: "us.example", port: 1080 },
      { id: "us-2", protocol: "socks", server: "us2.example", port: 1080 }
    ],
    groups: [{ id: "us", name: "US Auto", type: "url_test", members: ["us-1", "us-2"], options: { url: "https://example.com/generate_204", interval: 300 } }],
    routing: { rules: [{ id: "r", name: "group", order: 1, match: { domain_suffix: ["example.com"] }, action: { type: "route", target: "us" } }] }
  });
  assert.equal(result.config["proxy-groups"][0].name, "US Auto");
  assert.deepEqual(result.config["proxy-groups"][0].proxies, ["us-1", "us-2"]);
  assert.equal(result.config["proxy-groups"][0].type, "url-test");
  assert.equal(result.config.rules.find((rule) => rule === "DOMAIN-SUFFIX,example.com,US Auto"), "DOMAIN-SUFFIX,example.com,US Auto");
  assert.equal(result.groups[0].target, "US Auto");
});

test("rejects unsupported sing-box load-balance instead of emitting a non-native outbound", () => {
  assert.throws(() => compileUnifiedConfig({
    kernel: Kernels.SING_BOX,
    nodes: [{ id: "a", protocol: "socks", server: "a.example", port: 1080 }, { id: "b", protocol: "socks", server: "b.example", port: 1080 }],
    groups: [{ id: "auto", name: "Auto", type: "load_balance", members: ["a", "b"], options: { strategy: "random" } }]
  }), /unsupported sing-box group type without semantic downgrade: load_balance/);
});

test("rejects Xray groups instead of silently downgrading their semantics", () => {
  assert.throws(() => compileUnifiedConfig({
    kernel: Kernels.XRAY,
    nodes: [{ id: "a", protocol: "socks", server: "a.example", port: 1080 }, { id: "b", protocol: "socks", server: "b.example", port: 1080 }],
    groups: [{ id: "auto", name: "Auto", type: "select", members: ["a", "b"] }]
  }), /Xray does not support unified group type without semantic downgrade: select/);
});


test("rewrites node route targets to kernel-visible names and fails closed on unknown targets", () => {
  const result = compileUnifiedConfig({
    kernel: Kernels.MIHOMO,
    nodes: [{ id: "node-1", name: "US 01", protocol: "socks", server: "us.example", port: 1080 }],
    routing: { rules: [{ id: "r", name: "node", order: 1, match: { domain: ["example.com"] }, action: { type: "route", target: "node-1" } }] }
  });
  assert.equal(result.config.rules.find((rule) => rule === "DOMAIN,example.com,US 01"), "DOMAIN,example.com,US 01");

  assert.throws(() => compileUnifiedConfig({
    kernel: Kernels.MIHOMO,
    nodes: [{ id: "node-1", protocol: "socks", server: "us.example", port: 1080 }],
    routing: { defaultAction: { type: "route", target: "missing" } }
  }), /routing references missing node or group: missing/);
});


test("normalizes group members when node names differ from canonical IDs", () => {
  const mihomo = compileUnifiedConfig({
    kernel: Kernels.MIHOMO,
    nodes: [{ id: "node-1", name: "US 01", protocol: "socks", server: "us.example", port: 1080 }],
    groups: [{ id: "us", type: "select", members: ["node-1"] }]
  });
  assert.deepEqual(mihomo.config["proxy-groups"][0].proxies, ["US 01"]);

  const singBox = compileUnifiedConfig({
    kernel: Kernels.SING_BOX,
    nodes: [{ id: "node-1", name: "US 01", protocol: "socks", server: "us.example", port: 1080 }],
    groups: [{ id: "us", type: "select", members: ["node-1"] }]
  });
  assert.deepEqual(singBox.config.outbounds.find((outbound) => outbound.tag === "us").outbounds, ["US 01"]);
});

test("fails closed when a group references an unknown member", () => {
  assert.throws(() => compileUnifiedConfig({
    kernel: Kernels.MIHOMO,
    nodes: [{ id: "node-1", protocol: "socks", server: "us.example", port: 1080 }],
    groups: [{ id: "us", type: "select", members: ["missing"] }]
  }), /group references missing node or group: missing/);
});


test("compiler excludes failed and disabled group members from the kernel config", () => {
  const result = compileUnifiedConfig({
    kernel: Kernels.MIHOMO,
    nodes: [
      { id: "ok", protocol: "socks", server: "ok.example", port: 1080 },
      { id: "failed", protocol: "socks", server: "failed.example", port: 1080 },
      { id: "disabled", protocol: "socks", server: "disabled.example", port: 1080 }
    ],
    states: { failed: "failed", disabled: "disabled" },
    groups: [{ id: "auto", name: "Auto", type: "select", members: ["ok", "failed", "disabled"] }]
  });
  assert.deepEqual(result.config["proxy-groups"][0].proxies, ["ok"]);
});

test("compiler omits an empty region group and fails closed for an empty non-region group", () => {
  const region = compileUnifiedConfig({
    kernel: Kernels.MIHOMO,
    nodes: [{ id: "failed", protocol: "socks", server: "failed.example", port: 1080 }],
    states: { failed: "failed" },
    groups: [{ id: "us", name: "US", type: "region", members: ["failed"] }]
  });
  assert.deepEqual(region.config["proxy-groups"], undefined);

  assert.throws(() => compileUnifiedConfig({
    kernel: Kernels.MIHOMO,
    nodes: [{ id: "failed", protocol: "socks", server: "failed.example", port: 1080 }],
    states: { failed: "failed" },
    groups: [{ id: "auto", name: "Auto", type: "select", members: ["failed"] }]
  }), /group has no usable members: auto/);
});


test("nested group compilation propagates unusable child groups", () => {
  const result = compileUnifiedConfig({
    kernel: Kernels.MIHOMO,
    nodes: [
      { id: "ok", protocol: "socks", server: "ok.example", port: 1080 },
      { id: "failed", protocol: "socks", server: "failed.example", port: 1080 }
    ],
    states: { failed: "failed" },
    groups: [
      { id: "child", name: "Child", type: "select", members: ["failed"] },
      { id: "parent", name: "Parent", type: "select", members: ["child", "ok"] }
    ]
  });
  assert.deepEqual(result.config["proxy-groups"].map((group) => group.name), ["Parent"]);
  assert.deepEqual(result.config["proxy-groups"][0].proxies, ["ok"]);
});

test("nested group compilation preserves kernel-visible child targets", () => {
  const result = compileUnifiedConfig({
    kernel: Kernels.SING_BOX,
    nodes: [{ id: "ok", name: "OK", protocol: "socks", server: "ok.example", port: 1080 }],
    groups: [
      { id: "child", name: "Child", type: "select", members: ["ok"] },
      { id: "parent", name: "Parent", type: "select", members: ["child"] }
    ]
  });
  assert.deepEqual(result.config.outbounds.find((item) => item.tag === "parent").outbounds, ["child"]);
});

test("nested group cycles fail closed", () => {
  assert.throws(() => compileUnifiedConfig({
    kernel: Kernels.MIHOMO,
    groups: [
      { id: "a", name: "A", type: "select", members: ["b"] },
      { id: "b", name: "B", type: "select", members: ["a"] }
    ]
  }), /group reference cycle/);
});
