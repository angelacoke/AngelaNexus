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
  for (const path of ["late-connections.patch", "tunnel/statistic/manager.go", "tunnel/statistic/tracker.go", "tunnel/tunnel.go", "component/nat/table.go", "tunnel/connection.go"]) {
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
        natTable: "component/nat/table.go",
        connection: "tunnel/connection.go",
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
      for (const name of ["manager", "tracker", "tunnel", "natTable", "connection"]) {
        assert.deepEqual(evidence.lateConnectionsPatch.patchedSources[name], { path: sources[name], sha256: hash(join(root, "mihomo", sources[name])) });
      }
      assert.equal(evidence.lateConnectionsPatch.sha256, hash(join(process.cwd(), "native/android/mihomo-bridge/late-connections.patch")));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("TCP admits each retry result before early-data handshake and never wraps it twice", () => {
  const patch = read("native/android/mihomo-bridge/late-connections.patch");
  const tcp = patch.slice(patch.indexOf("func handleTCPConn"));
  const additions = tcp.split("\n").filter(line => line.startsWith("+") && !line.startsWith("+++")).map(line => line.slice(1)).join("\n");
  assert.equal((additions.match(/NewTCPTrackerAtEpoch\(/g) || []).length, 1);
  assert.match(additions, /NewTCPTrackerAtEpoch\(remoteConn, statistic\.DefaultManager, metadata, rule, 0, 0, true, registrationEpoch\)/);
  assert.match(additions, /cancel\(\).*do not redial/);
  assert.doesNotMatch(additions, /int64\(peekLen\)/);
  const regressions = read("native/android/mihomo-bridge/late_tunnel_integration_test.go");
  assert.match(regressions, /NeedHandshake\(\) bool/);
});

test("real tracker Close preserves registration until success or closed-only error", () => {
  const patch = read("native/android/mihomo-bridge/late-connections.patch");
  for (const [receiver, conn] of [["tt", "Conn"], ["ut", "PacketConn"]]) {
    assert.ok(patch.includes(`+\terr := ${receiver}.${conn}.Close()`));
    assert.ok(patch.includes(`+\tif err == nil || registrationClosedOnly(err) {\n+\t\t${receiver}.manager.Leave(${receiver})`));
  }
});

test("UDP NAT keys are generation-scoped and cleanup is sender-owned", () => {
  const patch = read("native/android/mihomo-bridge/late-connections.patch");
  assert.match(patch, /key := packet\.Key\(\)/);
  assert.match(patch, /if metadata\.Type == C\.TUN/);
  assert.match(patch, /key = fmt\.Sprintf\("%d:%s", registrationEpoch, key\)/);
  assert.match(patch, /natTable\.DeleteIf\(key, sender\)/);
  assert.match(patch, /func \(t \*Table\) DetachLocalConnsIf\(key string, sender C\.PacketSender\) \\*\[\]\*net\.UDPConn/);
  assert.match(patch, /closeAllLocalCoon\(key, sender\)/);
});

test("ordinary TCP and UDP setup timeouts inherit registration cancellation", () => {
  const patch = read("native/android/mihomo-bridge/late-connections.patch");
  assert.equal((patch.match(/\+\s*registrationEpoch, registrationCtx := statistic\.DefaultManager\.Registration\(\)/g) || []).length, 2);
  for (const protocol of ["TCP", "UDP"]) {
    assert.ok(patch.split("\n").some(line => line.startsWith("+") && line.slice(1).trim() === `ctx, cancel := context.WithTimeout(registrationCtx, C.Default${protocol}Timeout)`));
  }
  assert.match(patch, /\+\s*if err = ctx\.Err\(\); err != nil/);
  assert.match(patch, /\+func \(m \*Manager\) Registration\(\) \(uint64, context\.Context\)/);
  assert.doesNotMatch(patch, /releaseRegistration/);
});

test("cancellation regressions remain in CI-selected groups and retain ignoring-proxy coverage", () => {
  const manager = read("native/android/mihomo-bridge/late_connections_integration_test.go");
  const tunnel = read("native/android/mihomo-bridge/late_tunnel_integration_test.go");
  assert.match(manager, /func TestAngelaNexusLateConnectionsRegistrationContextCancellation\(/);
  assert.match(tunnel, /func TestAngelaNexusLateTunnelRetryCanceledBeforeFirstAttempt\(/);
  assert.match(tunnel, /ignoreContext/);
  assert.match(tunnel, /TCP setup context cancellation/);
  assert.match(tunnel, /UDP setup context cancellation/);
  assert.match(tunnel, /underlying stale TCP socket not closed/);
  assert.match(tunnel, /underlying stale UDP socket not closed/);
});

test("bridge closes tracked handshakes before bounded setup drain and preserves late cleanup failures", () => {
  const cleanup = bridge.split("func closeAndroidResources()")[1].split("func stopTunError")[0];
  assert.ok(cleanup.indexOf("StopRegistrations()") < cleanup.indexOf("closeConnections(connections)"));
  assert.ok(cleanup.indexOf("closeConnections(connections)") < cleanup.indexOf("waitAndroidSetups(androidSetupDrainTimeout)"));
  assert.ok(cleanup.indexOf("waitAndroidSetups(androidSetupDrainTimeout)") < cleanup.lastIndexOf("DefaultManager.Range"));
  assert.match(cleanup, /errAndroidLateSetupConnections/);
  assert.match(cleanup, /errors\.Join\(listenerErr, connectionErr, setupErr, lateErr\)/);
  assert.match(cleanup, /androidSetupDrainTimeout = 2 \* time\.Second/);
  assert.match(cleanup, /context\.WithTimeout\(context\.Background\(\), timeout\)/);
  assert.match(cleanup, /DefaultManager\.WaitSetups\(ctx\)/);
});

test("ordinary setup drain has explicit acquisition and release without joining relays", () => {
  const patch = read("native/android/mihomo-bridge/late-connections.patch");
  assert.match(patch, /func \(m \*Manager\) BeginSetup\(epoch uint64\) \(func\(\), error\)/);
  assert.match(patch, /func \(m \*Manager\) WaitSetups\(ctx context\.Context\) error/);
  assert.equal((patch.match(/DefaultManager\.BeginSetup\(registrationEpoch\)/g) || []).length, 2);
  assert.match(patch, /sync\.Once/);
  assert.match(patch, /ctx\.Done\(\)/);
});
