import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const bridge = read("native/android/mihomo-bridge/bridge.go");
const lifecycle = read("native/android/mihomo-bridge/lifecycle.go");
const workflow = yaml.load(read(".github/workflows/mihomo-android-native-build.yml"));

test("Android owns applied resolver generations across reload and only explicit stop cancels them", () => {
  const apply = bridge.split("func applyAndroidConfiguration(")[1].split("//export angelaInit")[0];
  assert.match(apply, /defer func\(\) \{\s*if generation, ok := resolver\.DefaultResolver\.\(dns\.Resolvers\); ok \{\s*androidRuntime\.ownResolvers\(generation\)/);
  assert.ok(apply.indexOf("ownResolvers(generation)") < apply.indexOf("executor.ApplyConfig"));
  const cleanup = bridge.split("func closeAndroidResources()")[1].split("const androidSetupDrainTimeout")[0];
  assert.doesNotMatch(cleanup, /cancelResolvers|waitResolvers|stopAndroidDNS/);
  const stop = bridge.split("func stopAndroidDNS(")[1].split("func waitAndroidSetups")[0];
  assert.ok(stop.indexOf("cancelResolvers()") < stop.indexOf("dns.StopServer(ctx)"));
  assert.ok(stop.indexOf("dns.StopServer(ctx)") < stop.indexOf("waitResolvers(ctx)"));
  assert.match(stop, /errors.Join\(listenerErr, resolverErr\)/);
  assert.match(stop, /dnsCleanupPending = err != nil/);
  assert.match(bridge, /providersStopped \|\| androidRuntime.resolversStopped \|\| androidRuntime.dnsCleanupPending/);
});

test("resolver timeout retains ownership until successful explicit stop retry", () => {
  assert.match(lifecycle, /resolvers\s+map\[androidResolverGeneration\]struct\{\}/);
  const wait = lifecycle.split("func (l *androidTunLifecycle) waitResolvers(")[1];
  assert.match(wait, /if err := generation.Wait\(ctx\); err != nil \{[\s\S]*continue\s*\}\s*delete\(l.resolvers, generation\)/);
  assert.doesNotMatch(wait, /resolversStopped = false/);
});

test("native CI stages and executes nonempty resolver generation race regressions", () => {
  const host = workflow.jobs.build.steps.find(step => step.name === "Test bridge state against pinned Mihomo on host (not Android TUN)");
  assert.match(host.run, /dns_resolver_lifecycle_integration_test\.go.*dns\/angelanexus_dns_resolver_lifecycle_integration_test\.go/);
  assert.match(host.run, /go test -list '\^TestAngelaNexusDNSResolver' \.\/dns \| grep '\^TestAngelaNexusDNSResolver'/);
  assert.match(host.run, /go test -race -run '\^TestAngelaNexusDNSResolver' -count=20 -timeout=180s \.\/dns/);
  assert.match(host.run, /go test -race -tags=with_gvisor,cmfa -run '\^TestAndroidBridgeDNS' -count=20/);
});
