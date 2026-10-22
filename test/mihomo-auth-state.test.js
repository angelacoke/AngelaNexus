import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const root = process.cwd();
const read = path => readFileSync(join(root, path), "utf8");
const patch = read("native/android/mihomo-bridge/auth-state.patch");
const prepare = read("native/android/mihomo-bridge/prepare-upstream.py");
const workflow = yaml.load(read(".github/workflows/mihomo-android-native-build.yml"));
const host = workflow.jobs.build.steps.find(step => step.name === "Test bridge state against pinned Mihomo on host (not Android TUN)");

test("auth-state production patch and literal source contract are non-empty", () => {
  assert.ok(patch.trim().length > 0);
  assert.match(patch, /^--- adapter\/inbound\/auth\.go\n\+\+\+ adapter\/inbound\/auth\.go/m);
  for (const path of [
    "adapter/inbound/auth.go",
    "adapter/inbound/ipfilter.go",
    "adapter/inbound/auth_state.go",
    "listener/auth/auth.go",
    "listener/mixed/mixed.go",
    "listener/socks/tcp.go",
    "listener/http/server.go",
    "hub/executor/executor.go",
  ]) assert.ok(prepare.includes(`"${path}"`), path);
  assert.match(prepare, /AUTH_STATE_PATCH_SHA256 = "[0-9a-f]{64}"/);
  assert.match(prepare, /AUTH_STATE_INPUTS = \{[\s\S]*\}/);
  assert.match(prepare, /AUTH_STATE_OUTPUTS = \{[\s\S]*\}/);
});

test("auth integration tests have executable, non-placeholder bodies and race coverage", () => {
  const source = read("native/android/mihomo-bridge/auth_state_integration_test.go");
  assert.match(source, /func TestAngelaNexusAuthState/);
  assert.doesNotMatch(source, /TODO|IMPLEMENT|placeholder|t\.Skip\(/i);
  for (const name of [
    "TestAngelaNexusAuthStateAtomicPublication",
    "TestAngelaNexusAuthStateCopiesAndAdmission",
    "TestAngelaNexusAuthStateExecutorApplyAndForceFalse",
  ]) assert.match(source, new RegExp(`func ${name}\\(`));
  assert.match(host.run, /go test -race -run '\^TestAngelaNexusAuthState'/);
  assert.match(host.run, /-race .*?-run '\^TestAngelaNexusAuthState/);
  assert.match(host.run, /-count=20/);
});

test("auth negative control requires six forced non-opt-in mutations and restores sources", () => {
  const negative = read("native/android/mihomo-bridge/test-auth-state.py");
  assert.match(negative, /pinned-admission/);
  assert.match(negative, /concurrent-apply/);
  assert.match(negative, /for n in \(1, 2, 3\)/);
  assert.match(negative, /for name, test, race in targets/);
  assert.match(negative, /--logs/);
  assert.match(negative, /finally:[\s\S]*restore|finally:[\s\S]*write_text/s);
  assert.match(host.run, /test-auth-state\.py.*--logs/);
});
