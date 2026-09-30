import test from "node:test";
import assert from "node:assert/strict";
import { PROBE_TYPES, HEALTH_STATES, createHopProbeSpec, evaluateHopHealth, aggregateChainHealth } from "../src/platform/chain-health.js";
import { createChainTopology } from "../src/platform/chain-topology.js";

test("each hop can be probed independently with ICMP or TCP", () => {
  assert.deepEqual(createHopProbeSpec({hopId:"a",host:"1.1.1.1",port:443,type:PROBE_TYPES.ICMP}).type, "icmp");
  assert.deepEqual(createHopProbeSpec({hopId:"b",host:"example.com",port:443,type:PROBE_TYPES.TCP}).type, "tcp");
});

test("hop latency is classified without hiding a failed hop", () => {
  assert.equal(evaluateHopHealth({success:true,latencyMs:80}).state, HEALTH_STATES.HEALTHY);
  assert.equal(evaluateHopHealth({success:true,latencyMs:800}).state, HEALTH_STATES.DEGRADED);
  assert.equal(evaluateHopHealth({success:false,latencyMs:null}).state, HEALTH_STATES.DOWN);
});

test("chain health identifies the highest-latency hop", () => {
  const health = aggregateChainHealth([
    {hopId:"a",state:"healthy",latencyMs:50},
    {hopId:"b",state:"degraded",latencyMs:800},
    {hopId:"c",state:"healthy",latencyMs:90},
  ]);
  assert.equal(health.state, HEALTH_STATES.DEGRADED);
  assert.equal(health.bottleneckHopId, "b");
});

test("topology exposes every hop and connection state", () => {
  const topology = createChainTopology({
    id:"p1",
    hops:[
      {id:"a",kernel:"sing-box",listen:{host:"127.0.0.1",port:41001}},
      {id:"b",kernel:"xray",listen:{host:"127.0.0.1",port:41002}},
      {id:"c",kernel:"mihomo",listen:{host:"127.0.0.1",port:41003}},
    ],
  }, {
    a:{state:"healthy",latencyMs:50,success:true},
    b:{state:"degraded",latencyMs:800,success:true},
    c:{state:"healthy",latencyMs:90,success:true},
  });
  assert.deepEqual(topology.edges.map(e=>[e.from,e.to,e.state]), [["a","b","up"],["b","c","up"]]);
  assert.equal(topology.health.bottleneckHopId,"b");
});
