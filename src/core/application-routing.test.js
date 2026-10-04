import test from "node:test";
import assert from "node:assert/strict";
import {
  createApplicationRoutingIdentity,
  toRoutingContext,
  validateApplicationRoutingIdentity,
} from "./application-routing.js";

test("normalizes cross-platform application identity into routing context", () => {
  const identity = createApplicationRoutingIdentity({
    id: "android:com.example.client",
    platform: "android",
    packageName: "com.example.client",
    processName: ["com.example.client", "client"],
    processPath: "/data/app/client/base.apk",
  });

  const context = toRoutingContext(identity, {
    observedProcessName: "com.example.client:proxy",
  });

  assert.deepEqual(context.package_name, ["com.example.client"]);
  assert.deepEqual(context.process_name, ["com.example.client", "client", "com.example.client:proxy"]);
  assert.deepEqual(context.process_path, ["/data/app/client/base.apk"]);
});

test("rejects an identity without an executable application selector", () => {
  const result = validateApplicationRoutingIdentity({
    id: "broken",
    platform: "linux",
  });
  assert.equal(result.ok, false);
});

test("requires a supported platform", () => {
  assert.throws(
    () => createApplicationRoutingIdentity({
      platform: "unknown",
      processName: "client",
    }),
    /unsupported application routing platform/,
  );
});
