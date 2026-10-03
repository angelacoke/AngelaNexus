import test from "node:test";
import assert from "node:assert/strict";
import { compileUnifiedConfig } from "../src/core/config-compiler.js";
import { Kernels } from "../src/core/model.js";
import { validateCompiledConfig } from "../src/core/compiled-config-validation.js";

test("compiles a simple unified node to Mihomo", () => {
  const result = compileUnifiedConfig({
    kernel: Kernels.MIHOMO,
    nodes: [{ id: "us-1", name: "us-1", protocol: "socks", server: "example.com", port: 1080 }],
    groups: [],
    dns: {},
    routing: {}
  });
  assert.equal(result.status, "compiled");
  assert.equal(result.config.proxies[0].name, "us-1");
  assert.equal(result.config.proxies[0].port, 1080);
  assert.equal(result.validation.ok, true);
});

test("compiles a simple unified node to sing-box", () => {
  const result = compileUnifiedConfig({
    kernel: Kernels.SING_BOX,
    nodes: [{ id: "us-1", name: "us-1", protocol: "socks", server: "example.com", port: 1080 }],
    groups: [],
    dns: {},
    routing: {}
  });
  assert.equal(result.config.outbounds[0].tag, "us-1");
  assert.equal(result.config.outbounds[0].server_port, 1080);
});

test("refuses an unverified protocol instead of silently degrading", () => {
  assert.throws(() => compileUnifiedConfig({
    kernel: Kernels.XRAY,
    nodes: [{ id: "h2", name: "h2", protocol: "hysteria2", server: "example.com", port: 443 }]
  }), /not safely compilable/);
});

test("maps canonical TLS and transport to Mihomo", () => {
  const result = compileUnifiedConfig({ kernel: Kernels.MIHOMO, nodes: [{
    id:"v", name:"v", protocol:"vless", server:"example.com", port:443, uuid:"u",
    tls:{enabled:true, serverName:"example.com", alpn:["h2"]},
    transport:{type:"ws",path:"/api",headers:{Host:"example.com"}}
  }]});
  assert.equal(result.config.proxies[0].sni,"example.com");
  assert.equal(result.config.proxies[0]["ws-opts"].path,"/api");
});

test("maps canonical TLS and transport to Xray", () => {
  const result = compileUnifiedConfig({ kernel: Kernels.XRAY, nodes: [{
    id:"v", name:"v", protocol:"vless", server:"example.com", port:443, uuid:"u",
    tls:{enabled:true, serverName:"example.com"},
    transport:{type:"grpc",serviceName:"api"}
  }]});
  assert.equal(result.config.outbounds[0].streamSettings.network,"grpc");
  assert.equal(result.config.outbounds[0].streamSettings.tlsSettings.serverName,"example.com");
});

test("compiles Xray VLESS and Shadowsocks using protocol-specific settings", () => {
  const vless = compileUnifiedConfig({ kernel: Kernels.XRAY, nodes: [{
    id:"v", name:"v", protocol:"vless", server:"example.com", port:443, uuid:"u"
  }]});
  assert.equal(vless.config.outbounds[0].settings.address, "example.com");
  assert.equal(vless.config.outbounds[0].settings.id, "u");

  const ss = compileUnifiedConfig({ kernel: Kernels.XRAY, nodes: [{
    id:"ss", name:"ss", protocol:"shadowsocks", server:"example.com", port:443,
    password:"p", method:"aes-128-gcm"
  }]});
  assert.equal(ss.config.outbounds[0].settings.address, "example.com");
  assert.equal(ss.config.outbounds[0].settings.port, 443);
  assert.equal(ss.config.outbounds[0].settings.method, "aes-128-gcm");
  assert.equal(ss.config.outbounds[0].settings.password, "p");
});

test("compiles sing-box Hysteria2 password and TLS semantics", () => {
  const result = compileUnifiedConfig({ kernel: Kernels.SING_BOX, nodes: [{
    id:"h", name:"h", protocol:"hysteria2", server:"example.com", port:443,
    password:"p", tls:{enabled:true, serverName:"example.com", alpn:["h3"]}
  }]});
  assert.equal(result.config.outbounds[0].password, "p");
  assert.equal(result.config.outbounds[0].tls.server_name, "example.com");
  assert.deepEqual(result.config.outbounds[0].tls.alpn, ["h3"]);
});

test("preserves canonical auth flow across kernel compilers", () => {
  const node = { id:"v", name:"v", protocol:"vless", server:"example.com", port:443, uuid:"u", flow:"xtls-rprx-vision" };
  const xray = compileUnifiedConfig({ kernel: Kernels.XRAY, nodes:[node] });
  const sing = compileUnifiedConfig({ kernel: Kernels.SING_BOX, nodes:[node] });
  const mihomo = compileUnifiedConfig({ kernel: Kernels.MIHOMO, nodes:[node] });
  assert.equal(xray.config.outbounds[0].settings.flow, "xtls-rprx-vision");
  assert.equal(sing.config.outbounds[0].flow, "xtls-rprx-vision");
  assert.equal(mihomo.config.proxies[0].flow, "xtls-rprx-vision");
});

test("compiles a resolved chain through the full unified pipeline for all kernels", () => {
  const common = {
    nodes: [
      { id: "entry", protocol: "socks", server: "entry.example", port: 1080 },
      { id: "exit", protocol: "socks", server: "exit.example", port: 1080 }
    ],
    groups: [],
    chains: [{ id: "entry-to-exit", mode: "node->node", hops: [{ id: "entry" }, { id: "exit" }] }],
    routing: {
      rules: [{
        id: "chain-rule",
        name: "Chain rule",
        order: 1,
        match: { domain_suffix: ["example.com"] },
        action: { type: "chain", target: "entry-to-exit" }
      }],
      defaultAction: { type: "chain", target: "entry-to-exit" }
    }
  };

  const mihomo = compileUnifiedConfig({ ...common, kernel: Kernels.MIHOMO });
  assert.equal(mihomo.config.proxies.find((p) => p.name === "exit")["dialer-proxy"], "entry");
  assert.equal(mihomo.config.rules.find((rule) => rule === "DOMAIN-SUFFIX,example.com,exit"), "DOMAIN-SUFFIX,example.com,exit");
  assert.ok(mihomo.config.rules.includes("IP-CIDR6,::/0,REJECT"));
  assert.ok(mihomo.config.rules.includes("DST-PORT,3478,REJECT"));
  assert.equal(mihomo.config.rules[mihomo.config.rules.length - 1], "MATCH,exit");

  const sing = compileUnifiedConfig({ ...common, kernel: Kernels.SING_BOX });
  assert.equal(sing.config.outbounds.find((o) => o.tag === "exit").detour, "entry");
  assert.equal(sing.config.route.rules.find((rule) => rule.outbound === "exit").outbound, "exit");
  assert.equal(sing.config.route.final, "exit");

  const xray = compileUnifiedConfig({ ...common, kernel: Kernels.XRAY });
  assert.equal(xray.config.outbounds.find((o) => o.tag === "exit").streamSettings.sockopt.dialerProxy, "entry");
  assert.equal(xray.config.dns.tag, "Nexus-DNS");
  assert.deepEqual(xray.config.routing.rules[0].inboundTag, ["Nexus-DNS"]);
  assert.equal(xray.config.routing.rules[0].ruleTag, "Nexus-DNS-Route");
  assert.ok(xray.config.routing.rules.some((rule) => rule.outboundTag === "exit"));
  assert.ok(xray.config.routing.rules.some((rule) => rule.ruleTag === "Nexus-IPv6-Blackhole" && rule.outboundTag === "Nexus-Blackhole"));
  assert.ok(xray.config.routing.rules.some((rule) => rule.ruleTag === "Nexus-WebRTC-3478" && rule.outboundTag === "Nexus-Blackhole"));
  assert.equal(xray.config.routing.rules.at(-1).outboundTag, "exit");
});

test("resolves chain groups from unified group arrays before kernel compilation", () => {
  const result = compileUnifiedConfig({
    kernel: Kernels.MIHOMO,
    nodes: [
      { id: "entry", protocol: "socks", server: "entry.example", port: 1080 },
      { id: "exit-1", protocol: "socks", server: "exit1.example", port: 1080 },
      { id: "exit-2", protocol: "socks", server: "exit2.example", port: 1080 }
    ],
    groups: [{
      id: "exit-group",
      name: "Exit",
      type: "fallback",
      members: ["exit-1", "exit-2"]
    }],
    chains: [{
      id: "entry-to-exit",
      hops: [{ id: "entry" }, { group: "exit-group" }]
    }]
  });
  assert.equal(result.config.proxies.find((p) => p.name === "exit-1")["dialer-proxy"], "entry");
  assert.equal(result.chains[0].hops.join(","), "entry,exit-1");
});

test("fails closed when a configured chain is missing a node", () => {
  assert.throws(() => compileUnifiedConfig({
    kernel: Kernels.MIHOMO,
    nodes: [{ id: "entry", protocol: "socks", server: "entry.example", port: 1080 }],
    chains: [{ id: "broken", hops: [{ id: "entry" }, { id: "missing" }] }]
  }), /chain broken cannot be safely compiled.*chain node not found/);
});

test("fails closed when routing references a missing chain", () => {
  assert.throws(() => compileUnifiedConfig({
    kernel: Kernels.SING_BOX,
    nodes: [{ id: "entry", protocol: "socks", server: "entry.example", port: 1080 }],
    routing: {
      rules: [{
        id: "chain-rule",
        name: "Chain rule",
        order: 1,
        match: { domain_suffix: ["example.com"] },
        action: { type: "chain", target: "missing" }
      }]
    }
  }), /routing references missing chain/);
});


test("compiles a state-aware nested group chain consistently across kernels", () => {
  const common = {
    nodes: [
      { id: "entry-id", name: "Entry Name", protocol: "socks", server: "entry.example", port: 1080 },
      { id: "dead-id", name: "Dead Name", protocol: "socks", server: "dead.example", port: 1080 },
      { id: "exit-id", name: "Exit Name", protocol: "socks", server: "exit.example", port: 1080 }
    ],
    states: { "dead-id": "failed" },
    groups: [
      { id: "dead-group", name: "Dead Group", type: "fallback", members: ["dead-id"] },
      { id: "exit-group", name: "Exit Group", type: "fallback", members: ["dead-group", "exit-id"] }
    ],
    chains: [{ id: "entry-to-exit", hops: [{ id: "entry-id" }, { group: "exit-group" }] }],
    routing: { rules: [{ id: "r", name: "chain", order: 1, match: { domain_suffix: ["example.com"] }, action: { type: "chain", target: "entry-to-exit" } }] }
  };

  const mihomo = compileUnifiedConfig({ ...common, kernel: Kernels.MIHOMO });
  assert.equal(mihomo.chains[0].hops.join(","), "entry-id,exit-id");
  assert.equal(mihomo.config.proxies.find((p) => p.name === "Exit Name")["dialer-proxy"], "Entry Name");
  assert.equal(mihomo.config.rules.find((rule) => rule === "DOMAIN-SUFFIX,example.com,Exit Name"), "DOMAIN-SUFFIX,example.com,Exit Name");

  const singBox = compileUnifiedConfig({ ...common, kernel: Kernels.SING_BOX });
  assert.equal(singBox.chains[0].hops.join(","), "entry-id,exit-id");
  assert.equal(singBox.config.outbounds.find((o) => o.tag === "Exit Name").detour, "Entry Name");
  assert.ok(singBox.config.route.rules.some((rule) => rule.outbound === "Exit Name"));

  const xray = compileUnifiedConfig({ ...common, kernel: Kernels.XRAY });
  assert.equal(xray.chains[0].hops.join(","), "entry-id,exit-id");
  assert.equal(xray.config.outbounds.find((o) => o.tag === "Exit Name").streamSettings.sockopt.dialerProxy, "Entry Name");
  assert.ok(xray.config.routing.rules.some((rule) => rule.outboundTag === "Exit Name"));
});

test("fails closed when a chain group becomes entirely unusable", () => {
  assert.throws(() => compileUnifiedConfig({
    kernel: Kernels.SING_BOX,
    nodes: [
      { id: "entry", protocol: "socks", server: "entry.example", port: 1080 },
      { id: "dead", protocol: "socks", server: "dead.example", port: 1080 },
      { id: "exit", protocol: "socks", server: "exit.example", port: 1080 }
    ],
    states: { dead: "disabled" },
    groups: [{ id: "exit-group", type: "fallback", members: ["dead"] }],
    chains: [{ id: "broken", hops: [{ id: "entry" }, { group: "exit-group" }] }]
  }), /chain broken cannot be safely compiled.*no usable member/);
});

test("chain-only unsupported groups are omitted from kernel compilation", () => {
  const common = {
    nodes: [
      { id: "entry", protocol: "socks", server: "entry.example", port: 1080 },
      { id: "exit", protocol: "socks", server: "exit.example", port: 1080 }
    ],
    groups: [{ id: "exit-group", name: "Exit Group", type: "fallback", members: ["exit"] }],
    chains: [{ id: "entry-to-exit", hops: [{ id: "entry" }, { group: "exit-group" }] }],
    routing: { defaultAction: { type: "chain", target: "entry-to-exit" } }
  };

  for (const kernel of [Kernels.MIHOMO, Kernels.SING_BOX, Kernels.XRAY]) {
    const result = compileUnifiedConfig({ ...common, kernel });
    assert.equal(result.chains[0].hops.join(","), "entry,exit");
    assert.deepEqual(result.groups, []);
  }
});

test("directly routed unsupported groups still fail closed", () => {
  assert.throws(() => compileUnifiedConfig({
    kernel: Kernels.XRAY,
    nodes: [{ id: "exit", protocol: "socks", server: "exit.example", port: 1080 }],
    groups: [{ id: "exit-group", type: "fallback", members: ["exit"] }],
    routing: { defaultAction: { type: "route", target: "exit-group" } }
  }), /Xray does not support unified group type without semantic downgrade: fallback/);
});


test("materializes fail-closed terminal routing for all kernels", () => {
  const base = {
    nodes: [{ id: "us-1", name: "us-1", protocol: "socks", server: "example.com", port: 1080 }],
    groups: []
  };

  const mihomo = compileUnifiedConfig({ ...base, kernel: Kernels.MIHOMO });
  assert.equal(mihomo.config.rules.at(-1), "MATCH,REJECT");

  const sing = compileUnifiedConfig({ ...base, kernel: Kernels.SING_BOX });
  assert.equal(sing.config.route.final, "Nexus-Blackhole");
  assert.deepEqual(sing.config.outbounds.at(-1), { type: "block", tag: "Nexus-Blackhole" });
  assert.equal(sing.validation.ok, true);

  const xray = compileUnifiedConfig({ ...base, kernel: Kernels.XRAY });
  assert.equal(xray.config.routing.rules.at(-1).outboundTag, "Nexus-Blackhole");
  assert.equal(xray.config.outbounds.at(-1).protocol, "blackhole");
});


test("materializes effective security defaults into every kernel compilation", () => {
  const base = {
    nodes: [{ id: "us-1", name: "us-1", protocol: "socks", server: "example.com", port: 1080 }]
  };

  const mihomo = compileUnifiedConfig({ ...base, kernel: Kernels.MIHOMO });
  assert.ok(mihomo.config.rules.includes("IP-CIDR6,::/0,REJECT"));
  assert.ok(mihomo.config.rules.includes("DST-PORT,3478,REJECT"));

  const sing = compileUnifiedConfig({ ...base, kernel: Kernels.SING_BOX });
  assert.ok(sing.config.route.rules.some((rule) => rule.action === "reject" && rule.ip_cidr?.includes("::/0")));
  assert.ok(sing.config.route.rules.some((rule) => rule.action === "reject" && rule.port?.includes(3478)));

  const xray = compileUnifiedConfig({ ...base, kernel: Kernels.XRAY });
  assert.ok(xray.config.routing.rules.some((rule) => rule.ruleTag === "Nexus-IPv6-Blackhole"));
  assert.ok(xray.config.routing.rules.some((rule) => rule.ruleTag === "Nexus-WebRTC-3478"));
});

test("security leak blocks precede user routing rules in every kernel", () => {
  const base = {
    nodes: [{ id: "us-1", name: "us-1", protocol: "socks", server: "example.com", port: 1080 }],
    routing: {
      rules: [{
        id: "allow-all",
        name: "Allow all",
        enabled: true,
        match: { port: [3478] },
        action: { type: "route", target: "us-1" }
      }],
      defaultAction: { type: "route", target: "us-1" }
    }
  };

  const mihomo = compileUnifiedConfig({ ...base, kernel: Kernels.MIHOMO });
  assert.equal(mihomo.config.rules[0], "IP-CIDR6,::/0,REJECT");
  assert.equal(mihomo.config.rules[1], "DST-PORT,3478,REJECT");
  assert.equal(mihomo.config.rules.at(-1), "MATCH,us-1");

  const sing = compileUnifiedConfig({ ...base, kernel: Kernels.SING_BOX });
  assert.equal(sing.config.route.rules[0].action, "reject");
  assert.deepEqual(sing.config.route.rules[0].ip_cidr, ["::/0"]);
  assert.equal(sing.config.route.rules[1].action, "reject");
  assert.deepEqual(sing.config.route.rules[1].port, [3478]);
  assert.equal(sing.config.route.final, "us-1");

  const xray = compileUnifiedConfig({ ...base, kernel: Kernels.XRAY });
  assert.equal(xray.config.routing.rules[0].ruleTag, "Nexus-DNS-Route");
  assert.equal(xray.config.routing.rules[1].ruleTag, "Nexus-IPv6-Blackhole");
  assert.equal(xray.config.routing.rules[2].ruleTag, "Nexus-WebRTC-3478");
  assert.equal(xray.config.routing.rules.at(-1).outboundTag, "us-1");
});

test("preserves explicit secure routing default targets", () => {
  const base = {
    nodes: [{ id: "us-1", name: "us-1", protocol: "socks", server: "example.com", port: 1080 }],
    routing: { defaultAction: { type: "route", target: "us-1" } }
  };

  const mihomo = compileUnifiedConfig({ ...base, kernel: Kernels.MIHOMO });
  assert.equal(mihomo.config.rules.at(-1), "MATCH,us-1");

  const sing = compileUnifiedConfig({ ...base, kernel: Kernels.SING_BOX });
  assert.equal(sing.config.route.final, "us-1");

  const xray = compileUnifiedConfig({ ...base, kernel: Kernels.XRAY });
  assert.equal(xray.config.routing.rules.at(-1).outboundTag, "us-1");
});

test("rejects unsafe explicit routing default actions during preflight", () => {
  assert.throws(() => compileUnifiedConfig({
    kernel: Kernels.MIHOMO,
    nodes: [{ id: "us-1", protocol: "socks", server: "example.com", port: 1080 }],
    routing: { defaultAction: { type: "implicit-direct" } }
  }), /not safely compilable/);
});

test("integrates platform rule packages into the unified compilation pipeline", () => {
  const packageDefinition = {
    id: "builtin/platform-routing",
    version: 1,
    schemaVersion: 1,
    source: "builtin",
    publisher: "AngelaNexus",
    createdAt: "2026-10-03T00:00:00Z",
    updatedAt: "2026-10-03T00:00:00Z",
    rules: [
      {
        id: "platform.block-tracker",
        matchType: "domain-suffix",
        value: "tracker.example",
        action: "reject",
        priority: 1000
      },
      {
        id: "platform.proxy-service",
        matchType: "domain",
        value: "service.example",
        action: "proxy",
        priority: 900
      }
    ]
  };

  const common = {
    nodes: [{ id: "proxy", name: "Proxy", protocol: "socks", server: "proxy.example", port: 1080 }],
    groups: [],
    rulePackages: [packageDefinition],
    ruleTargets: { proxy: "proxy" }
  };

  const mihomo = compileUnifiedConfig({ ...common, kernel: Kernels.MIHOMO });
  assert.ok(mihomo.config.rules.includes("DOMAIN-SUFFIX,tracker.example,REJECT"));
  assert.ok(mihomo.config.rules.includes("DOMAIN,service.example,Proxy"));
  assert.equal(mihomo.ruleCompilation.ruleCount, 2);

  const singBox = compileUnifiedConfig({ ...common, kernel: Kernels.SING_BOX });
  assert.ok(singBox.config.route.rules.some((rule) => rule.domain_suffix?.includes("tracker.example") && rule.action === "reject"));
  assert.ok(singBox.config.route.rules.some((rule) => rule.domain?.includes("service.example") && rule.outbound === "Proxy"));

  const xray = compileUnifiedConfig({ ...common, kernel: Kernels.XRAY });
  assert.ok(xray.config.routing.rules.some((rule) => rule.domain?.includes("domain:tracker.example") && rule.outboundTag === "Nexus-Blackhole"));
  assert.ok(xray.config.routing.rules.some((rule) => rule.domain?.includes("full:service.example") && rule.outboundTag === "Proxy"));
});
