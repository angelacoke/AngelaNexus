import test from "node:test";
import assert from "node:assert/strict";
import { PipelineModes, createPipelineSpec, validatePipelineSpec } from "../src/core/pipeline.js";

test("pipeline spec is backend-neutral and immutable", () => {
  const spec = createPipelineSpec({ mode: PipelineModes.PROXY, target: "group-us" });
  assert.equal(spec.kind, "pipeline-spec");
  assert.equal(spec.mode, "proxy");
  assert.equal(spec.target, "group-us");
  assert.deepEqual(spec.hops, []);
  assert.equal(Object.isFrozen(spec), true);
});

test("chain preserves explicit hop order as pipeline semantics", () => {
  const spec = createPipelineSpec({
    mode: PipelineModes.CHAIN,
    hops: ["node-a", "node-b", "node-c"],
  });
  assert.deepEqual(spec.hops.map((hop) => hop.id), ["node-a", "node-b", "node-c"]);
  assert.deepEqual(spec.hops.map((hop) => hop.index), [0, 1, 2]);
});

test("duplicate chain hops fail closed", () => {
  const result = validatePipelineSpec({
    mode: PipelineModes.CHAIN,
    hops: ["node-a", "node-a"],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /duplicate hop/);
});

test("direct and reject pipelines cannot smuggle routing targets", () => {
  assert.equal(validatePipelineSpec({ mode: PipelineModes.DIRECT, target: "direct" }).ok, false);
  assert.equal(validatePipelineSpec({ mode: PipelineModes.REJECT, hops: ["node-a"] }).ok, false);
});

test("proxy requires an explicit target", () => {
  const result = validatePipelineSpec({ mode: PipelineModes.PROXY });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /target is required/);
});

test("chain cannot use a separate target", () => {
  const result = validatePipelineSpec({
    mode: PipelineModes.CHAIN,
    target: "unexpected",
    hops: ["node-a", "node-b"],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /separate target/);
});

test("unknown pipeline mode is rejected", () => {
  const result = validatePipelineSpec({ mode: "kernel-specific" });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /unsupported pipeline mode/);
});
