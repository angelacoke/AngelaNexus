import test from "node:test";
import assert from "node:assert/strict";
import { Kernels } from "./model.js";
import { compileGroups } from "./group-compiler.js";

test("profile feature switches are applied before group compilation", () => {
  const result = compileGroups([
    { id: "auto", name: "Auto", type: "select", members: ["n1"] },
    { id: "global", name: "Global", type: "select", members: ["n2"] },
  ], Kernels.MIHOMO, [
    { id: "n1", name: "Node 1" },
    { id: "n2", name: "Node 2" },
  ], undefined, {
    disabledGroupIds: ["global"],
  });

  assert.deepEqual(result.groups.map((group) => group.name), ["Auto"]);
  assert.equal(result.targetMap.has("global"), false);
  assert.equal(result.targetMap.get("auto"), "Auto");
});

test("profile group switches preserve ordinary compilation when no feature state is supplied", () => {
  const result = compileGroups([
    { id: "auto", name: "Auto", type: "select", members: ["n1"] },
  ], Kernels.MIHOMO, [
    { id: "n1", name: "Node 1" },
  ]);

  assert.equal(result.groups.length, 1);
  assert.equal(result.targetMap.get("auto"), "Auto");
});
