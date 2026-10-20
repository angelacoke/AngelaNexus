import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const workflow = yaml.load(read(".github/workflows/mihomo-android-native-build.yml"));
const steps = workflow.jobs.build.steps;
const bridge = read("native/android/mihomo-bridge/bridge.go");

test("CI stages and runs manager and actual tunnel regressions, rejecting empty selections", () => {
  const host = steps.find(step => step.name === "Test bridge state against pinned Mihomo on host (not Android TUN)");
  assert.equal(host.if, "matrix.abi == 'x86_64'");
  assert.match(host.run, /late_connections_integration_test\.go.*tunnel\/statistic\/angelanexus_late_connections_test\.go/);
  assert.match(host.run, /late_tunnel_integration_test\.go.*tunnel\/angelanexus_late_tunnel_test\.go/);
  for (const prefix of ["TestAngelaNexusLateConnections", "TestAngelaNexusLateTunnel"]) {
    assert.ok(host.run.includes(`-list '^${prefix}'`));
    assert.ok(host.run.includes(`grep '^${prefix}'`));
    assert.ok(host.run.includes(`-run '^${prefix}' -count=1 -timeout=90s`));
  }
});

test("the source adapter alone applies the reviewed late patch before bridge staging", () => {
  const stage = steps.find(step => step.name === "Add AngelaNexus Android bridge");
  assert.ok(stage.run.indexOf("prepare-upstream.py") < stage.run.indexOf("mkdir ./angelanexus_android"));
  assert.doesNotMatch(stage.run, /git apply|patch --/);
  const prepare = read("native/android/mihomo-bridge/prepare-upstream.py");
  assert.ok(prepare.indexOf("apply_statistics(root)\n    apply_late(root)") > 0);
  const provenance = steps.find(step => step.name === "Generate native build provenance evidence");
  for (const path of ["late-connections.patch", "tunnel/statistic/manager.go", "tunnel/statistic/tracker.go", "tunnel/tunnel.go"]) {
    assert.ok(provenance.run.includes(path), `missing build evidence: ${path}`);
  }
  assert.match(provenance.run, /"lateConnectionsPatch"/);
  assert.match(provenance.run, /"manager": \{"path": "tunnel\/statistic\/manager\.go"/);
  assert.match(provenance.run, /"tracker": \{"path": "tunnel\/statistic\/tracker\.go"/);
  assert.match(provenance.run, /"tunnel": \{"path": "tunnel\/tunnel\.go"/);
});

test("bridge closes registration before listener cleanup and reopens only on committed attachment", () => {
  const init = bridge.split("func init()")[1].split("func applyAndroidConfiguration")[0];
  assert.match(init, /DefaultManager\.StopRegistrations\(\)/);
  const cleanup = bridge.split("func closeAndroidResources()")[1].split("func stopTunError")[0];
  assert.ok(cleanup.indexOf("StopRegistrations()") < cleanup.indexOf("closeTun()"));
  assert.ok(cleanup.indexOf("StopRegistrations()") < cleanup.indexOf("DefaultManager.Range"));
  const start = bridge.split("func startAndroidTUNWithConstructor(")[1].split("func closeAndroidResources()")[0];
  assert.ok(start.indexOf("syscall.Close(fd)") < start.indexOf("StartRegistrations()"));
  assert.equal((bridge.match(/\.StartRegistrations\(/g) || []).length, 1);
  assert.equal((bridge.match(/\.StopRegistrations\(/g) || []).length, 2);
});

for (const matrix of workflow.jobs.build.strategy.matrix.include) {
  test(`native provenance shell executes with exact final source hashes: ${matrix.abi}`, () => {
    const root = mkdtempSync(join(tmpdir(), "angelanexus-provenance-shell-"));
    const step = steps.find(s => s.name === "Generate native build provenance evidence");
    const put = (path, content, mode) => {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, content, { mode });
    };
    const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
    try {
      const bin = join(root, "bin");
      put(join(bin, "go"), "#!/bin/sh\nprintf 'go version go1.24.8 linux/amd64\\n'\n", 0o755);
      put(join(bin, "git"), `#!/bin/sh\nprintf '${step.env.MIHOMO_COMMIT}\\n'\n`, 0o755);
      const ndk = join(root, "ndk");
      put(join(ndk, "toolchains/llvm/prebuilt/linux-x86_64/bin", matrix.cc), "#!/bin/sh\nprintf 'Android clang version fixture\\n'\n", 0o755);
      const artifact = join(root, `libclash-${matrix.abi}.so`);
      put(artifact, `fixture ELF ${matrix.abi}`);
      const sources = {
        server: "listener/sing_tun/server.go",
        manager: "tunnel/statistic/manager.go",
        tracker: "tunnel/statistic/tracker.go",
        tunnel: "tunnel/tunnel.go",
      };
      for (const [name, path] of Object.entries(sources)) put(join(root, "mihomo", path), `reviewed final ${name} output\n`);
      const run = step.run.replace(/\$\{\{ matrix\.(\w+) \}\}/g, (_, key) => matrix[key]);
      assert.doesNotMatch(run, /\$\{\{/);
      const result = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", run], {
        encoding: "utf8", timeout: 15_000,
        env: { ...process.env, ...step.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: root, ANDROID_NDK_ROOT: ndk, GITHUB_WORKSPACE: process.cwd() },
      });
      assert.equal(result.status, 0, result.stderr || result.error?.message);
      const evidence = JSON.parse(readFileSync(join(root, `mihomo-provenance-${matrix.abi}.json`), "utf8"));
      assert.equal(evidence.abi, matrix.abi);
      assert.equal(evidence.toolchain.goarch, matrix.goarch);
      assert.equal(evidence.toolchain.goarm, matrix.goarch === "arm" ? "7" : null);
      assert.equal(evidence.artifact.sha256, hash(artifact));
      assert.equal(evidence.ownershipAdapter.patchedSource.sha256, hash(join(root, "mihomo", sources.server)));
      assert.equal(evidence.statisticsPatch.patchedSource.sha256, hash(join(root, "mihomo", sources.manager)));
      for (const name of ["manager", "tracker", "tunnel"]) {
        assert.deepEqual(evidence.lateConnectionsPatch.patchedSources[name], { path: sources[name], sha256: hash(join(root, "mihomo", sources[name])) });
      }
      assert.equal(evidence.lateConnectionsPatch.sha256, hash(join(process.cwd(), "native/android/mihomo-bridge/late-connections.patch")));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
