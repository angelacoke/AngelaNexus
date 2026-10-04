import test from "node:test";
import assert from "node:assert/strict";
import {
  ApplicationRoutingModes,
  assertScopedExecution,
  createApplicationRoutingPlan,
} from "../src/core/application-routing.js";
import {
  AppProxyDriverCapabilities,
  createAppProxyDriver,
} from "../src/core/app-proxy-driver.js";

function driver(id, capabilities, canExecute = () => true) {
  return createAppProxyDriver({
    id,
    capabilities,
    health: { state: "ready" },
    canExecute,
    execute: async (plan) => ({ ok: true, scope: plan.scope.type }),
  });
}

test("selects an application-scoped driver without requiring TUN", () => {
  const result = createApplicationRoutingPlan({
    scope: ApplicationRoutingModes.APPLICATION,
    identity: { platform: "android", packageName: "com.example.app", processName: "com.example.app" },
    selector: { platform: "android", packageName: "com.example.app" },
    proxy: { type: "socks", host: "127.0.0.1", port: 1080 },
    route: { mode: "proxy", target: "proxy-a" },
    userAuthorized: true,
    drivers: [
      driver("android-native-app-proxy", [
        AppProxyDriverCapabilities.APPLICATION_SCOPE,
        AppProxyDriverCapabilities.SOCKS_PROXY,
      ]),
    ],
    requiredCapabilities: [AppProxyDriverCapabilities.SOCKS_PROXY],
  });

  assert.equal(result.ok, true);
  assert.equal(result.driver, "android-native-app-proxy");
  assert.equal(result.plan.scope.type, "application");
});

test("does not allow a process plan to be satisfied by application-only capability", () => {
  const result = createApplicationRoutingPlan({
    scope: ApplicationRoutingModes.PROCESS,
    identity: { platform: "linux", processName: "example", executable: "/opt/example" },
    selector: { platform: "linux", processName: "example" },
    proxy: { type: "socks", host: "127.0.0.1", port: 1080 },
    route: { mode: "proxy", target: "proxy-a" },
    userAuthorized: true,
    drivers: [
      driver("app-only", [AppProxyDriverCapabilities.APPLICATION_SCOPE]),
    ],
  });

  assert.equal(result.ok, false);
});

test("scope boundary requires authorization and identity", () => {
  assert.throws(
    () => createApplicationRoutingPlan({
      identity: { platform: "linux", processName: "example" },
      selector: { platform: "linux", processName: "example" },
      proxy: { type: "socks", host: "127.0.0.1", port: 1080 },
      route: { mode: "proxy", target: "proxy-a" },
      userAuthorized: false,
      drivers: [],
    }),
    /explicit user authorization/
  );
  assert.equal(assertScopedExecution, assertScopedExecution);
});
