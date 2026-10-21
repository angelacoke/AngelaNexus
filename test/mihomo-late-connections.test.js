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
  assert.match(host.run, /quic_sender_integration_test\.go.*component\/sniffer\/angelanexus_quic_sender_integration_test\.go/);
  assert.ok(host.run.includes("-list '^TestAngelaNexusQUICSender'"));
  assert.match(host.run, /-list '\^TestAngelaNexusNATLocal'[^\n]*component\/nat/);
  assert.match(host.run, /grep '\^TestAngelaNexusNATLocal'/);
  assert.match(host.run, /-run '\^TestAngelaNexusNATLocal' -count=20 -timeout=90s/);
  assert.ok(host.run.includes("grep '^TestAngelaNexusQUICSender'"));
  assert.ok(host.run.includes("-run '^TestAngelaNexusQUICSenderDoSniffCallbackCanReenterClose$' -count=1 -timeout=30s"));
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
  for (const path of ["late-connections.patch", "tunnel/statistic/manager.go", "tunnel/statistic/tracker.go", "tunnel/tunnel.go", "component/nat/table.go", "tunnel/connection.go", "component/sniffer/quic_sniffer.go"]) {
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
        quicSniffer: "component/sniffer/quic_sniffer.go",
        tproxyPacket: "listener/tproxy/packet.go",
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
      for (const name of ["manager", "tracker", "tunnel", "natTable", "connection", "quicSniffer", "tproxyPacket"]) {
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

test("UDP queue admission is serialized with close and drops packets outside its lock", () => {
  const patch = read("native/android/mihomo-bridge/late-connections.patch");
  const sender = patch.slice(patch.indexOf("--- tunnel/connection.go"));
  const additions = sender.split("\n").filter(line => (line.startsWith("+") && !line.startsWith("+++")) || line.startsWith(" ")).map(line => line.slice(1)).join("\n");
  assert.match(additions, /queueMu sync\.Mutex/);
  assert.match(additions, /s\.queueMu\.Lock\(\)/);
  assert.match(additions, /s\.queueMu\.Unlock\(\)\n\s*packet\.Drop\(\)/);
  assert.doesNotMatch(additions, /packet\.Drop\(\)\n\s*s\.queueMu\.Unlock\(\)/);
  assert.match(additions, /s\.queueMu\.Lock\(\)\n\s*s\.cancel\(\)\n\s*s\.queueMu\.Unlock\(\)/);
});

test("UDP queue race and reentrant Drop regressions stay in the real tunnel CI group", () => {
  const source = read("native/android/mihomo-bridge/late_tunnel_integration_test.go");
  for (const name of ["QueueCloseRace", "DropCanReenter", "ConcurrentClosesDropOnce"]) {
    assert.ok(source.includes(`func TestAngelaNexusLateTunnelSender${name}(`));
  }
  assert.match(source, /Do not close again before checking/);
  assert.match(source, /drops\.Load\(\)/);
  assert.match(source, /queue-full/);
  assert.match(source, /already-closed/);
});

test("dequeued UDP packets recheck cancellation across callbacks and before writes", () => {
  const patch = read("native/android/mihomo-bridge/late-connections.patch");
  const sender = patch.slice(patch.indexOf("--- tunnel/connection.go"));
  const additions = sender.split("\n").filter(line => (line.startsWith("+") && !line.startsWith("+++")) || line.startsWith(" ")).map(line => line.slice(1)).join("\n");
  assert.match(additions, /case packet := <-s\.ch:[\s\S]*if s\.ctx\.Err\(\) != nil \{\n\s*packet\.Drop\(\)\n\s*return/);
  assert.match(additions, /defer packet\.Drop\(\)\n\s*if s\.ctx\.Err\(\) != nil/);
  assert.match(additions, /if s\.ctx\.Err\(\) != nil \{\n\s*return\n\s*\}\n\s*s\.AddMapping/);
  assert.match(additions, /handleUDPToRemote\(s\.ctx, packet, pc, addr\)/);
  assert.match(additions, /data := packet\.Data\(\)[\s\S]*if err := ctx\.Err\(\); err != nil \{\n\s*return err\n\s*\}\n\s*if _, err := pc\.WriteTo\(data, addr\)/);
});

test("UDP processing cancellation has late-result, reentry and fresh-forwarding controls", () => {
  const source = read("native/android/mihomo-bridge/late_tunnel_integration_test.go");
  for (const name of ["ResolveAfterClose", "CallbackClose", "CanceledDequeued", "WriteBackAfterClose", "InFlightWrite"]) {
    assert.ok(source.includes(`func TestAngelaNexusLateTunnelSender${name}(`));
  }
  for (const mode of ["late-success", "late-error", "fresh-success", "write-entered", "write-back", "data"]) {
    assert.ok(source.includes(`"${mode}"`));
  }
  assert.match(source, /Close independent of blocked write-back/);
  assert.match(source, /canceled resolution installed a NAT mapping/);
});

test("UDP replies retain the registration context rather than the short-lived dial timeout", () => {
  const patch = read("native/android/mihomo-bridge/late-connections.patch");
  assert.match(patch, /go handleUDPToLocal\(registrationCtx, writeBackProxy, pc, sender, key, oAddrPort\)/);
  assert.doesNotMatch(patch, /go handleUDPToLocal\(ctx, writeBackProxy/);
  assert.match(patch, /func handleUDPToLocal\(ctx context\.Context, writeBack C\.WriteBack/);
});

test("UDP replies recheck cancellation after reads and mapping with buffer returns", () => {
  const patch = read("native/android/mihomo-bridge/late-connections.patch");
  const reply = patch.slice(patch.indexOf("func handleUDPToLocal(ctx"));
  assert.match(reply, /if err != nil \|\| ctx\.Err\(\) != nil/);
  assert.match(reply, /if put != nil \{\n\+\s+put\(\)/);
  assert.ok(reply.indexOf("ctx.Err()") < reply.indexOf("pc.SetReadDeadline"));
  assert.ok(reply.lastIndexOf("if ctx.Err() != nil") < reply.indexOf("_, err = writeBack.WriteBack"));
  assert.match(reply, /checkpoint is not a join: an admitted WriteBack may still finish/);
});

test("reverse UDP regressions cover stale reads, reentry, buffer ownership and real replies", () => {
  const source = read("native/android/mihomo-bridge/late_tunnel_integration_test.go");
  for (const name of ["LocalWriteBackCancellation", "HandlerContextLifetime"]) {
    assert.ok(source.includes(`func TestAngelaNexusLateTunnelReply${name}(`));
  }
  for (const mode of ["blocked-read-late-buffer-is-dropped", "restore-reentrant-cancel", "fresh-success", "in-flight-writeback", "blocked-writeback-retains-buffer", "deadline-cancel-skips-read", "wait-error-returns-put", "wait-error-nil-put", "writeback-error-still-puts", "canceled-at-entry"]) {
    assert.ok(source.includes(`"${mode}"`));
  }
  assert.match(source, /return 1, w\.err/);
  assert.match(source, /fresh UDP write-back/);
  assert.match(source, /lateGateWait\(t, conn\.readStarted, "fresh UDP reverse read entry"\)/);
});

test("UDP senders observe registration cancellation independently of reverse cleanup", () => {
  const patch = read("native/android/mihomo-bridge/late-connections.patch");
  assert.match(patch, /sender := newPacketSenderWithContext\(registrationCtx\)/);
  assert.match(patch, /return newPacketSenderWithContext\(context\.Background\(\)\)/);
  assert.match(patch, /func newPacketSenderWithContext\(parent context\.Context\) C\.PacketSender/);
  assert.match(patch, /ctx, cancel := context\.WithCancel\(parent\)/);
  assert.match(patch, /context\.AfterFunc\(ctx, sender\.Close\)/);
  assert.match(patch, /defer stopClose\(\)/);
});

test("UDP Process owns a final serialized drain when parent cancellation ends it", () => {
  const patch = read("native/android/mihomo-bridge/late-connections.patch");
  const process = patch.slice(patch.indexOf("func (s *packetSender) Process"));
  assert.match(process, /defer s\.Close\(\)/);
  assert.match(process, /not a join of callbacks or writes already in flight/);
});

test("QUIC sniffer regression is copied and race-tested in CI", () => {
  const host = steps.find(step => step.name === "Test bridge state against pinned Mihomo on host (not Android TUN)");
  assert.match(host.run, /quic_sender_integration_test\.go.*component\/sniffer\/angelanexus_quic_sender_integration_test\.go/);
  assert.match(host.run, /go test -race[^\n]+TestAngelaNexusQUICSenderDoSniffCallbackCanReenterClose[^\n]+component\/sniffer/);
  const source = read("native/android/mihomo-bridge/quic_sender_integration_test.go");
  assert.match(source, /replaceDomain[\s\S]*q\.Close\(\)/);
  assert.match(source, /q\.buffer != nil/);
});

test("UDP sniff cancellation uses scoped AfterFunc and post-callback checkpoint", () => {
  const tunnel = read("native/android/mihomo-bridge/late-connections.patch");
  assert.match(tunnel, /context\.AfterFunc\(ctx, sender\.Close\)/);
  assert.match(tunnel, /defer stopClose\(\)/);
  assert.match(tunnel, /if canceled := ctx\.Err\(\); canceled != nil/);
  assert.match(tunnel, /sniffUDPWithContext\(registrationCtx, sender, metadata\)/);
});

test("TCP sniff cancellation closes inbound only during sniff and rejects canceled success", () => {
  const patch = read("native/android/mihomo-bridge/late-connections.patch");
  const tcp = patch.slice(patch.indexOf("func handleTCPConn"), patch.indexOf("func retry"));
  const additions = tcp.split("\n").filter(line => line.startsWith("+") && !line.startsWith("+++")).map(line => line.slice(1)).join("\n");
  assert.match(additions, /if registrationCtx\.Err\(\) != nil \{\n\s*return\n\s*\}/);
  assert.match(additions, /stopSniffClose := context\.AfterFunc\(registrationCtx, func\(\) \{ _ = conn\.Close\(\) \}\)/);
  assert.match(additions, /sniffed := snifferDispatcher\.TCPSniff\(conn, metadata\)\n\s*stopSniffClose\(\)/);
  const afterSniff = additions.slice(additions.indexOf("stopSniffClose()"));
  assert.ok(afterSniff.indexOf("registrationCtx.Err()") < afterSniff.indexOf("if sniffed"));
  assert.doesNotMatch(additions, /WaitGroup|\.Wait\(|<-.*[Dd]one/);
});

test("TCP sniff regressions use real pure-IP sniffing, cancellation wakeup and positive relay", () => {
  const source = read("native/android/mihomo-bridge/late_tunnel_integration_test.go");
  for (const name of ["StopWakesRealSniff", "CanceledBeforeSniff", "CanceledSniffResultDoesNotDial", "HTTPSniffAndRelay"]) {
    assert.ok(source.includes(`func TestAngelaNexusLateTunnelTCPSniff${name}(`));
  }
  assert.match(source, /S\.Config\{Enable: true, ParsePureIp: true/);
  assert.match(source, /SetReadDeadline\(time\.Time\) error \{ return nil \}/);
  assert.match(source, /canceled sniff continued metadata resolution/);
  assert.match(source, /real sniff domain=%q/);
  assert.match(source, /closeOnce\.Do/);
});

test("TCP setup cancellation wakes inbound peek and unregisters before relay ownership", () => {
  const patch = read("native/android/mihomo-bridge/late-connections.patch");
  const tcp = patch.slice(patch.indexOf("func handleTCPConn"), patch.indexOf("func retry"));
  const additions = tcp.split("\n").filter(line => line.startsWith("+") && !line.startsWith("+++")).map(line => line.slice(1)).join("\n");
  assert.match(additions, /stopSetupClose := context\.AfterFunc\(ctx, func\(\) \{ _ = conn\.Close\(\) \}\)/);
  assert.match(additions, /defer stopSetupClose\(\)/);
  assert.equal((additions.match(/if err = ctx\.Err\(\); err != nil/g) || []).length, 3);
  assert.match(additions, /if ctx\.Err\(\) != nil \{\n\s*_ = remoteConn\.Close\(\)\n\s*return/);
  assert.match(additions, /stopSetupClose\(\)\n\s*releaseSetup\(\)/);
  assert.doesNotMatch(additions, /WaitGroup|\.Wait\(|<-.*[Dd]one/);
  assert.match(bridge, /const androidSetupDrainTimeout = 2 \* time\.Second/);
});

test("early TCP cancellation regressions cover real BufferedConn and established relay ownership", () => {
  const source = read("native/android/mihomo-bridge/late_tunnel_integration_test.go");
  for (const name of ["CancelWakesPeek", "CanceledBufferedData", "CancelAfterWriteNoRelay", "NoHandshakeCanceledResult", "SuccessUnregistersCancel"]) {
    assert.ok(source.includes(`func TestAngelaNexusLateTunnelEarlyHandshake${name}(`));
  }
  assert.match(source, /background peek Read entry/);
  assert.match(source, /cc\.Conn\(\)\.Buffered\(\) != len\(payload\)/);
  assert.match(source, /Reading early bytes alone does not prove Write returned or setup released/);
  assert.match(source, /relay after stop/);
});

test("reopening registration invalidates tokens observed while stopped but open starts stay idempotent", () => {
  const patch = read("native/android/mihomo-bridge/late-connections.patch");
  const start = patch.slice(patch.indexOf("+func (m *Manager) StartRegistrations()"), patch.indexOf("+var errRegistrationStopped"));
  const code = start.split("\n").filter(line => line.startsWith("+")).map(line => line.slice(1)).join("\n");
  assert.match(code, /if m\.registrationOpen \{\n\s*m\.registrationMu\.Unlock\(\)\n\s*return\n\s*\}/);
  assert.match(code, /m\.registrationEpoch\+\+\n\s*m\.registrationOpen = true/);
  assert.ok(code.indexOf("return") < code.indexOf("m.registrationEpoch++"));
  assert.ok(code.indexOf("m.registrationEpoch++") < code.indexOf("m.registrationGen ="));
  assert.equal((code.match(/registrationEpoch\+\+/g) || []).length, 1);
});

test("stopped-token regressions exercise closed-gate acquisition, close retries and open-start compatibility", () => {
  const source = read("native/android/mihomo-bridge/late_connections_integration_test.go");
  for (const name of ["BeginSetupAfterRestart", "JoinReentrantClose", "RealTrackersAfterRestart", "StartIdempotentPreservesSetup", "ConcurrentRestart"]) {
    assert.ok(source.includes(`func TestAngelaNexusLateConnectionsStoppedToken${name}(`));
  }
  assert.match(source, /m\.StopRegistrations\(\)\n\s*stoppedEpoch, stoppedCtx := m\.Registration\(\)/);
  assert.match(source, /zero-value/);
  assert.match(source, /repeated-stop/);
  assert.match(source, /failed close lost retry ownership/);
  assert.match(source, /sameEpoch != epoch \|\| sameCtx != ctx/);
});

test("handshake retry observes tracker cleanup completion rather than the inner socket close signal", () => {
  const source = read("native/android/mihomo-bridge/late_tunnel_integration_test.go");
  const retry = source.slice(source.indexOf("func TestAngelaNexusLateTunnelHandshakeRetry("), source.indexOf("func TestAngelaNexusLateTunnelRejectHandshake("));
  assert.match(source, /if p\.secondEntered != nil \{\n\s*close\(p\.secondEntered\)/);
  assert.ok(retry.indexOf("retry dial after tracker cleanup") < retry.indexOf("if got := lateHandshakeTrackerCount()"));
  assert.ok(retry.indexOf("if got := lateHandshakeTrackerCount()") < retry.indexOf("\n\trelease()"));
});

test("UDP forwarding termination retires only its sender-owned NAT entry without joining the reverse reader", () => {
  const patch = read("native/android/mihomo-bridge/late-connections.patch");
  assert.match(patch, /defer closeAllLocalCoon\(key, sender\)\n\+\s*releaseSetup\(\)/);
  assert.match(patch, /sender\.Process\(pc, proxy\)/);
  assert.match(patch, /natTable\.DetachLocalConnsIf\(lAddr, sender\)/);
  assert.doesNotMatch(patch, /GetOrCreateAtEpoch/);
  const source = read("native/android/mihomo-bridge/late_tunnel_integration_test.go");
  assert.match(source, /func TestAngelaNexusLateTunnelSenderProcessRetiresNATWhileReaderBlocked\(/);
  assert.match(source, /\[\]C\.Type\{C\.TUN, C\.TPROXY\}/);
  assert.match(source, /Process exit retained NAT while reverse reader was blocked/);
  assert.match(source, /lateNATRead\(t, peer, "after-old-cleanup"\)/);
});

test("successful handshake regression observes inbound writer completion and retains post-stop relay checks", () => {
  const source = read("native/android/mihomo-bridge/late_tunnel_integration_test.go");
  const success = source.slice(source.indexOf("func TestAngelaNexusLateTunnelEarlyHandshakeSuccessUnregistersCancel("));
  assert.match(success, /ip\.SetWriteDeadline/);
  assert.match(success, /written <- err/);
  assert.match(success, /if err := <-written; err != nil/);
  assert.ok(success.indexOf('writeInbound(relay, "relay success")') < success.indexOf("StopRegistrations()"));
  assert.ok(success.indexOf('writeInbound(relay, "relay after stop")') > success.indexOf("StopRegistrations()"));
});


test("new NAT retirement API, removals, wait helper, TProxy fail-closed interface and CI coverage are structural", () => {
  const patch = read("native/android/mihomo-bridge/late-connections.patch");
  assert.match(patch, /func \(t \*Table\) DetachLocalConnsIf\(key string, sender C\.PacketSender\)/);
  assert.match(patch, /func closeAllLocalCoon\(lAddr string, sender C\.PacketSender\)/);
  assert.doesNotMatch(patch, /GetOrCreateAtEpoch/);
  assert.match(patch, /func \(m \*Manager\) WaitSetups\(ctx context\.Context\) error/);
  assert.match(patch, /--- listener\/tproxy\/packet\.go\n\+\+\+ listener\/tproxy\/packet\.go/);
  assert.match(patch, /TProxy|TPROXY/);
  const host = steps.find(step => step.name === "Test bridge state against pinned Mihomo on host (not Android TUN)");
  assert.match(host.run, /cp .*late_tunnel_integration_test\.go/);
  assert.match(host.run, /go test -race/);
});
