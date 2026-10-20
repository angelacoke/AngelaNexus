import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";

const workflow = yaml.load(readFileSync(new URL("../.github/workflows/android-auto-smoke.yml", import.meta.url), "utf8"));
const smoke = workflow.jobs.smoke.steps.find(step => step.id === "smoke");

for (const exitCode of [0, 1, 124]) {
  test(`Android auto smoke propagates verifier exit ${exitCode} and retains diagnostics`, () => {
    const dir = mkdtempSync(path.join(tmpdir(), "nexus-workflow-"));
    try {
      const bin = path.join(dir, "bin");
      mkdirSync(bin);
      mkdirSync(path.join(dir, "platform-tools"));
      writeFileSync(path.join(bin, "node"), `#!/bin/sh\necho verifier-output\nexit ${exitCode}\n`, { mode: 0o755 });
      writeFileSync(path.join(dir, "platform-tools", "adb"), "#!/bin/sh\necho fixture-device-output\n", { mode: 0o755 });
      const result = spawnSync("bash", ["-c", smoke.run.replaceAll("${{ steps.runid.outputs.id }}", "12345")], {
        encoding: "utf8",
        timeout: 5000,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ANDROID_HOME: dir,
          RUNNER_TEMP: dir, APK: path.join(dir, "app.apk"), GITHUB_OUTPUT: path.join(dir, "outputs"),
          GITHUB_STEP_SUMMARY: path.join(dir, "summary") },
      });
      assert.equal(result.status, exitCode === 0 ? 0 : 1, result.stderr);
      const verdict = readFileSync(path.join(dir, "smoke", "verdict.md"), "utf8");
      assert.match(verdict, exitCode === 0 ? /\*\*PASSED\*\*/ : /\*\*FAILED\*\*/);
      assert.match(readFileSync(path.join(dir, "smoke", "runtime.txt"), "utf8"), /verifier-output/);
      assert.match(readFileSync(path.join(dir, "smoke", "logcat.txt"), "utf8"), /fixture-device-output/);
      assert.match(readFileSync(path.join(dir, "outputs"), "utf8"), exitCode === 0 ? /result=PASSED/ : /result=FAILED/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("Android auto smoke skips PR runs without release artifacts and always cleans up", () => {
  assert.match(workflow.jobs.smoke.if, /workflow_run\.event != 'pull_request'/);
  const checkout = workflow.jobs.smoke.steps.find(step => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkout.with.ref, "${{ github.workflow_sha }}");
  assert.equal(checkout.with["persist-credentials"], false);
  assert.equal(workflow.jobs.smoke.steps.find(step => step.name === "Stop emulator").if, "always()");
  assert.equal(workflow.jobs.smoke.steps.find(step => step.name === "Upload smoke artifacts").if, "always()");
});
