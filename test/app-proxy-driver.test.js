import test from "node:test";
import assert from "node:assert/strict";
import {
  AppProxyDriverCapabilities,
  createAppProxyDriver,
  createAppProxyExecutionPlan,
} from "../src/core/app-proxy-driver.js";

test("creates a scoped application proxy driver", () => {
  const driver = createAppProxyDriver({
    id: "env-proxy",
    capabilities: [
      AppProxyDriverCapabilities.APPLICATION_SCOPE,
      AppProxyDriverCapabilities.PROCESS_SCOPE,
      AppProxyDriverCapabilities.ENVIRONMENT_PROXY,
      AppProxyDriverCapabilities.SOCKS_PROXY,
    ],
    health: { state: "ready" },
    canExecute: (plan) => plan.scope?.type === "application",
    execute: async (plan) => ({ ok: true, plan }),
  });

  assert.equal(driver.type, "application-proxy");
  assert.equal(driver.health.state, "ready");
  assert.equal(driver.capabilities.includes("socks-proxy"), true);
});

test("requires explicit authorization and preserves scope", () => {
  const plan = createAppProxyExecutionPlan({
    application: {
      scope: "process",
      identity: {
        platform: "linux",
        processName: "example",
        processPath: "/opt/example/example",
      },
      selector: {
        platform: "linux",
        processName: "example",
      },
    },
    proxy: { type: "socks", host: "127.0.0.1", port: 1080 },
    route: { mode: "proxy", target: "proxy-a" },
    userAuthorized: true,
    kernel: "sing-box",
    decisionId: "decision-1",
  });

  assert.equal(plan.kind, "application-proxy-plan");
  assert.equal(plan.scope.type, "process");
  assert.equal(plan.proxy.port, 1080);
  assert.throws(
    () => createAppProxyExecutionPlan({
      application: plan.scope,
      proxy: plan.proxy,
      route: plan.route,
    }),
    /explicit user authorization/
  );
});
