import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

const load = name => yaml.load(readFileSync(`.github/workflows/${name}.yml`, "utf8"));

test("Mihomo producer records github.sha and checks the actual checkout", () => {
  const workflow = load("mihomo-android-native-build");
  const step = workflow.jobs.build.steps.find(s => s.name === "Generate native build provenance evidence");
  assert.equal(step.env.PROJECT_COMMIT, "${{ github.sha }}");
  assert.match(step.run, /test "\$\(git -C "\$GITHUB_WORKSPACE" rev-parse HEAD\)" = "\$PROJECT_COMMIT"/);
  assert.match(step.run, /"projectCommit": "\$PROJECT_COMMIT"/);
});

test("Mihomo consumer binds to producer head_sha, not workflow_run github.sha", () => {
  const workflow = load("android-native-package");
  assert.deepEqual(workflow.on.workflow_run.branches, ["main"]);
  const step = workflow.jobs.package.steps.find(s => s.name === "Install verified Mihomo libraries");
  assert.match(step.run, /--expected-project-commit "\$\{\{ github\.event\.workflow_run\.head_sha \}\}"/);
  assert.ok(step.run.indexOf("--expected-project-commit") < step.run.indexOf("mkdir -p"));
  assert.doesNotMatch(step.run, /\$\{\{ github\.sha \}\}/);
  assert.equal(workflow.jobs.package.if, "${{ needs.compliance-gate.outputs.approved == 'true' }}");
});
