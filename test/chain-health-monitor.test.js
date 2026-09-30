import test from "node:test";
import assert from "node:assert/strict";
import { createChainHealthMonitor } from "../src/platform/chain-health-monitor.js";
import { HEALTH_STATES, PROBE_TYPES } from "../src/platform/chain-health.js";

function spec(id = "a") {
  return { hopId: id, host: id + ".example", port: 443, type: PROBE_TYPES.TCP, timeoutMs: 1000 };
}

test("health monitor polls every registered hop and exposes independent state", async () => {
  const calls = [];
  const monitor = createChainHealthMonitor({
    probe: { async probe(value) { calls.push(value.hopId); return { success: true, latencyMs: value.hopId === "a" ? 40 : 700 }; } },
    thresholds: { degradedMs: 500 },
  });
  monitor.addHop(spec("a")); monitor.addHop(spec("b"));
  const snapshot = await monitor.poll();
  assert.deepEqual(calls.sort(), ["a", "b"]);
  assert.equal(snapshot.find(x => x.hopId === "a").state, HEALTH_STATES.HEALTHY);
  assert.equal(snapshot.find(x => x.hopId === "b").state, HEALTH_STATES.DEGRADED);
});

test("down state requires consecutive failures and recovery requires consecutive successes", async () => {
  let success = false;
  const monitor = createChainHealthMonitor({
    probe: { async probe() { return success ? { success: true, latencyMs: 30 } : { success: false, latencyMs: null }; } },
    thresholds: { downFailures: 2, recoveries: 2 },
  });
  monitor.addHop(spec("a"));
  let s = await monitor.poll(); assert.equal(s[0].state, HEALTH_STATES.UNKNOWN);
  s = await monitor.poll(); assert.equal(s[0].state, HEALTH_STATES.DOWN);
  success = true;
  s = await monitor.poll(); assert.equal(s[0].state, HEALTH_STATES.DOWN);
  s = await monitor.poll(); assert.equal(s[0].state, HEALTH_STATES.HEALTHY);
});

test("stopping the monitor prevents stale in-flight probes from mutating state", async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const monitor = createChainHealthMonitor({ probe: { async probe() { await pending; return { success: true, latencyMs: 10 }; } } });
  monitor.addHop(spec("a"));
  const running = monitor.start();
  await monitor.stop();
  release();
  await running;
  assert.equal(monitor.getState("a").state, HEALTH_STATES.UNKNOWN);
  assert.equal(monitor.isRunning(), false);
});

test("monitor lifecycle schedules and clears recurring polling", async () => {
  const timers = [];
  const monitor = createChainHealthMonitor({
    probe: { async probe() { return { success: true, latencyMs: 10 }; } },
    setTimer(fn) { timers.push(fn); return timers.length; },
    clearTimer(handle) { timers[handle - 1] = null; },
  });
  monitor.addHop(spec("a"));
  await monitor.start({ immediate: false });
  assert.equal(monitor.isRunning(), true);
  assert.equal(timers.filter(Boolean).length, 1);
  await monitor.stop();
  assert.equal(monitor.isRunning(), false);
  assert.equal(timers.filter(Boolean).length, 0);
});
