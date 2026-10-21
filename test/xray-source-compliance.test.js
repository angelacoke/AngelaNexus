import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, readFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = process.cwd();
const bridge = join(root, "native/android/xray-bridge");
const prep = join(bridge, "prepare-upstream.py");
const verifier = join(bridge, "verify-artifact.py");
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const run = (cwd, ...args) => spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
const git = (cwd, ...args) => run(cwd, "git", ...args);
const output = (r) => `${r.stdout}\n${r.stderr}`;
const must = (r) => { assert.equal(r.status, 0, output(r)); return r; };

function makeFixture() {
  const d = mkdtempSync(join(tmpdir(), "xray-source-compliance-"));
  const tools = join(d, "bridge"); mkdirSync(tools, { recursive: true });
  for (const name of ["prepare-upstream.py", "verify-artifact.py"]) {
    cpSync(join(bridge, name), join(tools, name)); chmodSync(join(tools, name), 0o755);
  }
  const wrapper = join(d, "libXray"), core = join(d, "Xray-core");
  for (const p of [wrapper, core]) {
    mkdirSync(p, { recursive: true }); must(git(p, "init", "-q"));
    must(git(p, "config", "user.email", "test@example.invalid"));
    must(git(p, "config", "user.name", "fixture"));
  }
  const wrapperFiles = {
    "go.mod": "module fixture/libxray\n\ngo 1.27\n",
    "go.sum": "fixture go sum\n",
    "xray/xray.go": "package xray\n",
    "build/main.py": "print('fixture')\n",
    "build/app/build.py": "print('fixture')\n",
    "build/app/android.py": "print('fixture')\n",
  };
  const coreFiles = {
    "app/proxyman/outbound/handler.go": "package outbound\n\nconst Handler = 1\n",
    "app/proxyman/outbound/handler_test.go": "package outbound\n",
    "app/proxyman/outbound/outbound.go": "package outbound\n",
    "common/mux/client.go": "package mux\n",
    "common/mux/session.go": "package mux\n",
    "proxy/vless/outbound/outbound.go": "package outbound\n",
    "go.mod": "module fixture/core\n\ngo 1.27\n",
    "go.sum": "fixture core sum\n",
  };
  const put = (base, files) => { for (const [rel, content] of Object.entries(files)) { const p = join(base, rel); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, content); } };
  put(wrapper, wrapperFiles); put(core, coreFiles);
  must(git(wrapper, "add", ".")); must(git(wrapper, "commit", "-qm", "fixture"));
  must(git(core, "add", ".")); must(git(core, "commit", "-qm", "fixture"));
  const wc = git(wrapper, "rev-parse", "HEAD").stdout.trim();
  const cc = git(core, "rev-parse", "HEAD").stdout.trim();

  const changed = join(core, "app/proxyman/outbound/handler.go");
  writeFileSync(changed, "package outbound\n\nconst Handler = 2\n");
  const patch = join(tools, "core-lifecycle.patch");
  writeFileSync(patch, git(core, "diff", "--no-ext-diff", "--", "app/proxyman/outbound/handler.go").stdout);
  writeFileSync(changed, coreFiles["app/proxyman/outbound/handler.go"]);
  const clientTest = join(tools, "client_lifecycle_test.go");
  const vlessTest = join(tools, "vless_lifecycle_test.go");
  const wrapperTest = join(tools, "stop_mux_test.go");
  writeFileSync(clientTest, "package mux\n"); writeFileSync(vlessTest, "package outbound\n"); writeFileSync(wrapperTest, "package xray\n");
  const lock = {
    version: 1, toolchain: "go1.27.1",
    wrapper: { repository: "fixture/wrapper", commit: wc, files: Object.fromEntries(Object.keys(wrapperFiles).map((r) => [r, sha(join(wrapper, r))])) },
    core: { repository: "fixture/core", commit: cc, version: "fixture", files: Object.fromEntries(Object.keys(coreFiles).map((r) => [r, { before: sha(join(core, r)), after: sha(join(core, r)) }])) },
    patch: { file: "core-lifecycle.patch", sha256: sha(patch) },
    tests: {
      core: { "common/mux/client_lifecycle_test.go": { file: "client_lifecycle_test.go", sha256: sha(clientTest) }, "proxy/vless/outbound/angelanexus_lifecycle_test.go": { file: "vless_lifecycle_test.go", sha256: sha(vlessTest) } },
      wrapper: { "xray/stop_mux_test.go": { file: "stop_mux_test.go", sha256: sha(wrapperTest) } },
    },
  };
  // The patch changes one allow-listed file; its after digest must be authenticated.
  const after = "package outbound\n\nconst Handler = 2\n";
  lock.core.files["app/proxyman/outbound/handler.go"].after = shaBytes(after);
  writeFileSync(join(tools, "source-lock.json"), JSON.stringify(lock, null, 2) + "\n");
  let source = readFileSync(join(tools, "prepare-upstream.py"), "utf8")
    .replace(/WRAPPER_COMMIT = "[^"]+"/, `WRAPPER_COMMIT = "${wc}"`)
    .replace(/CORE_COMMIT = "[^"]+"/, `CORE_COMMIT = "${cc}"`)
    .replace(/CORE_VERSION = "[^"]+"/, 'CORE_VERSION = "fixture"');
  writeFileSync(join(tools, "prepare-upstream.py"), source);
  return { d, tools, wrapper, core, lockPath: join(tools, "source-lock.json"), patch, clientTest, vlessTest, wrapperTest };
}
function shaBytes(s) { return createHash("sha256").update(s).digest("hex"); }
function invoke(f, ...args) { return run(f.d, "python3", join(f.tools, "prepare-upstream.py"), "--wrapper", f.wrapper, "--core", f.core, "--lock", f.lockPath, ...args); }
function prepared(f) {
  must(invoke(f));
  writeFileSync(join(f.wrapper, "go.mod"), readFileSync(join(f.wrapper, "go.mod")) + "\nreplace github.com/xtls/xray-core => ../Xray-core\n");
  must(invoke(f, "--verify-prepared"));
}
function provenance(f) {
  const l = f.lock;
  return { version: 1, kernel: "xray", projectCommit: "fixture-project", wrapper: { repository: l.wrapper.repository, commit: l.wrapper.commit }, core: { repository: l.core.repository, commit: l.core.commit, version: l.core.version }, sourceLockSha256: sha(f.lockPath), patch: l.patch, inputs: { wrapper: Object.fromEntries(Object.entries(l.wrapper.files).map(([r, s]) => [r, s])), core: Object.fromEntries(Object.entries(l.core.files).map(([r, s]) => [r, s.before])) }, outputs: { core: Object.fromEntries(Object.entries(l.core.files).map(([r, s]) => [r, s.after])) }, tests: l.tests, toolchain: { requested: l.toolchain, actual: "go version go1.27.1 linux/amd64" } };
}
function artifact(f) {
  const a = join(f.d, "fixture.aar"), jar = join(f.d, "classes.jar"); writeFileSync(jar, "fixture classes");
  must(run(f.d, "zip", "-q", a, "classes.jar"));
  return a;
}
function verifyArtifact(f, a, p, ...args) { return run(f.d, "python3", join(f.tools, "verify-artifact.py"), a, "--provenance", p, "--lock", f.lockPath, ...args); }

for (const [name, mutate, needle] of [
  ["wrapper input", (f) => writeFileSync(join(f.wrapper, "xray/xray.go"), "tampered\n"), /wrapper input hash mismatch|unexpected dirty input checkout/],
  ["core input", (f) => writeFileSync(join(f.core, "go.mod"), "tampered\n"), /core input hash mismatch|unexpected dirty input checkout/],
  ["patch input", (f) => writeFileSync(f.patch, "tampered\n"), /patch missing or hash mismatch/],
  ["test input", (f) => writeFileSync(f.clientTest, "tampered\n"), /reviewed core test hash mismatch/],
]) test(`Xray source gate rejects ${name} tampering`, () => { const f = makeFixture(); try { mutate(f); const r = invoke(f, "--verify-only"); assert.notEqual(r.status, 0); assert.match(output(r), needle); } finally { rmSync(f.d, { recursive: true, force: true }); } });

test("clean fixed HEAD supports verify-only, apply, local replacement, and verify-prepared", () => { const f = makeFixture(); try { f.lock = JSON.parse(readFileSync(f.lockPath)); must(invoke(f, "--verify-only")); prepared(f); } finally { rmSync(f.d, { recursive: true, force: true }); } });
test("prepared output tampering is rejected", () => { const f = makeFixture(); try { prepared(f); writeFileSync(join(f.core, "app/proxyman/outbound/handler.go"), "tampered\n"); const r = invoke(f, "--verify-prepared"); assert.notEqual(r.status, 0); assert.match(output(r), /core output hash mismatch/); } finally { rmSync(f.d, { recursive: true, force: true }); } });

test("real source lock authenticates every patch and test input", () => { const lock = JSON.parse(readFileSync(join(bridge, "source-lock.json"))); assert.equal(sha(join(bridge, lock.patch.file)), lock.patch.sha256); for (const side of ["core", "wrapper"]) for (const spec of Object.values(lock.tests[side])) assert.equal(sha(join(bridge, spec.file)), spec.sha256); });

test("artifact verifier accepts a classes.jar fixture bound to source lock", () => { const f = makeFixture(); try { f.lock = JSON.parse(readFileSync(f.lockPath)); const p = join(f.d, "provenance.json"); writeFileSync(p, JSON.stringify(provenance(f), null, 2)); const a = artifact(f); const stamped = verifyArtifact(f, a, p, "--stamp"); must(stamped); must(verifyArtifact(f, a, p)); } finally { rmSync(f.d, { recursive: true, force: true }); } });

for (const [name, mutate] of [
  ["artifact", (f, a, p) => writeFileSync(a, "not a zip")],
  ["patch provenance", (f, a, p) => { const x = JSON.parse(readFileSync(p)); x.patch.sha256 = "0".repeat(64); writeFileSync(p, JSON.stringify(x)); }],
  ["output provenance", (f, a, p) => { const x = JSON.parse(readFileSync(p)); x.outputs.core["go.mod"] = "0".repeat(64); writeFileSync(p, JSON.stringify(x)); }],
  ["tests provenance", (f, a, p) => { const x = JSON.parse(readFileSync(p)); x.tests.core[Object.keys(x.tests.core)[0]].sha256 = "0".repeat(64); writeFileSync(p, JSON.stringify(x)); }],
  ["toolchain provenance", (f, a, p) => { const x = JSON.parse(readFileSync(p)); x.toolchain.actual = "go version go1.26.0 linux/amd64"; writeFileSync(p, JSON.stringify(x)); }],
]) test(`artifact verifier rejects ${name} tampering and stamp cannot mask source errors`, () => { const f = makeFixture(); try { f.lock = JSON.parse(readFileSync(f.lockPath)); const p = join(f.d, "provenance.json"); writeFileSync(p, JSON.stringify(provenance(f), null, 2)); const a = artifact(f); must(invoke(f, "--verify-only")); if (name === "artifact") must(verifyArtifact(f, a, p, "--stamp")); mutate(f, a, p); const r = verifyArtifact(f, a, p, "--stamp"); assert.notEqual(r.status, 0); } finally { rmSync(f.d, { recursive: true, force: true }); } });

test("both Android workflows retain host, local Android, and artifact verification gates", () => { const files = [join(root, ".github/workflows/android-build.yml"), join(root, ".github/workflows/xray-android-native-build.yml")]; for (const file of files) { const text = readFileSync(file, "utf8"); assert.match(text, /test-host\.sh/); assert.match(text, /build\/main\.py android local/); assert.match(text, /verify-artifact\.py/); assert.match(text, /verify-prepared/); } });
