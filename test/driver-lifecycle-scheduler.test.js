import test from "node:test";
import assert from "node:assert/strict";
import { createDriverSelection } from "../src/core/driver-scheduler.js";

function driver(id, capabilities, state = "ready") {
  return {
    id,
    capabilities,
    health: { state },
    canExecute() { return true; }
  };
}

test("suspended drivers are not executable", () => {
  const result = createDriverSelection({
    plan: { protocol: "vless" },
    requiredCapabilities: ["vless"],
    drivers: [
      driver("mihomo", ["vless"], "suspended"),
      driver("sing-box", ["vless"], "ready")
    ]
  });
  assert.equal(result.selected.id, "sing-box");
  assert.equal(result.rejected.find((item) => item.driver === "mihomo")?.status, "unavailable");
});

test("idle drivers remain eligible when the session requires activation", () => {
  const result = createDriverSelection({
    plan: { protocol: "vless" },
    requiredCapabilities: ["vless"],
    drivers: [driver("mihomo", ["vless"], "idle")]
  });
  assert.equal(result.selected.id, "mihomo");
});
