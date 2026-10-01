import assert from "node:assert/strict";
import test from "node:test";
import { resolveRoutingPolicy } from "./policy-engine.js";

function rule(id, domain, target, order) {
  return {
    id,
    name: id,
    order,
    match: { domain },
    action: { type: "route", target }
  };
}

test("parallel routing ignores rule order", () => {
  const policy = {
    rules: [
      rule("specific", "mail.example.com", "proxy-a", 100),
      rule("other", "www.example.com", "proxy-b", 0)
    ]
  };

  const result = resolveRoutingPolicy(policy, { domain: "mail.example.com" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.action, { type: "route", target: "proxy-a" });
  assert.equal(result.matches.length, 1);
});

test("parallel routing returns all matching rules when actions agree", () => {
  const policy = {
    rules: [
      {
        id: "suffix-a",
        name: "suffix-a",
        order: 100,
        match: { domain_suffix: "example.com" },
        action: { type: "route", target: "proxy-a" }
      },
      {
        id: "suffix-b",
        name: "suffix-b",
        order: 0,
        match: { domain_suffix: ".example.com" },
        action: { type: "route", target: "proxy-a" }
      }
    ]
  };

  const result = resolveRoutingPolicy(policy, { domain: "mail.example.com" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.action, { type: "route", target: "proxy-a" });
  assert.equal(result.matches.length, 2);
});

test("parallel routing fails closed on conflicting matching actions", () => {
  const policy = {
    rules: [
      rule("exact", "mail.example.com", "proxy-a", 0),
      {
        id: "suffix",
        name: "suffix",
        order: 100,
        match: { domain_suffix: "example.com" },
        action: { type: "route", target: "proxy-b" }
      }
    ]
  };

  const result = resolveRoutingPolicy(policy, { domain: "mail.example.com" });
  assert.equal(result.ok, false);
  assert.equal(result.conflict, true);
  assert.deepEqual(result.action, { type: "reject" });
  assert.equal(result.matches.length, 2);
});

test("disabled rules are absent from the parallel Match Set", () => {
  const policy = {
    rules: [
      {
        id: "disabled",
        name: "disabled",
        enabled: false,
        match: { domain: "example.com" },
        action: { type: "route", target: "proxy-a" }
      }
    ]
  };

  const result = resolveRoutingPolicy(policy, { domain: "example.com" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.action, { type: "route", target: "default" });
  assert.equal(result.matches.length, 0);
});
