import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflowCases = [
  { file: "../.github/workflows/android-release.yml", job: "release" },
  { file: "../.github/workflows/android-native-package.yml", job: "package" },
  { file: "../.github/workflows/android-build.yml", job: "android-release" },
];

function extractJob(workflow, jobName, workflowFile) {
  const marker = `  ${jobName}:`;
  const start = workflow.indexOf(`\n${marker}`);
  assert.notEqual(start, -1, `${workflowFile} must contain job ${jobName}`);
  const bodyStart = start + 1 + marker.length;
  const followingJob = workflow.slice(bodyStart).search(/^  [A-Za-z0-9_-]+:$/m);
  const end = followingJob === -1 ? workflow.length : bodyStart + followingJob;
  return workflow.slice(bodyStart, end);
}

test("Android release workflows build the canonical Core bundle before APK assembly", async () => {
  for (const { file, job } of workflowCases) {
    const workflow = await readFile(new URL(file, import.meta.url), "utf8");
    const jobBody = extractJob(workflow, job, file);
    const setupNode = jobBody.indexOf("actions/setup-node@v4");
    const installDependencies = jobBody.indexOf("npm ci --no-audit --no-fund");
    const buildBundle = jobBody.indexOf("npm run core:android:bundle");
    const verifyBundle = jobBody.indexOf("test -s native/android/app/src/main/assets/angelanexus-core.bundle.js");
    const assembleRelease = jobBody.indexOf("assembleRelease");

    for (const [label, index] of [
      ["Node setup", setupNode],
      ["dependency installation", installDependencies],
      ["Core bundle build", buildBundle],
      ["bundle verification", verifyBundle],
      ["release APK assembly", assembleRelease],
    ]) {
      assert.notEqual(index, -1, `${file} (${job}): ${label} step must exist`);
    }
    assert.ok(setupNode < installDependencies, `${file} (${job}): Node setup must precede npm ci`);
    assert.ok(installDependencies < buildBundle, `${file} (${job}): npm ci must precede the bundle build`);
    assert.ok(buildBundle < verifyBundle, `${file} (${job}): bundle must be verified after generation`);
    assert.ok(verifyBundle < assembleRelease, `${file} (${job}): bundle must be ready before APK assembly`);
  }
});
