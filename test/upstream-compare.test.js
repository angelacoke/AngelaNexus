import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compareRelease, readCompleteChangedFiles } from "../scripts/upstream-compare.js";

const entry = { repository: "SagerNet/sing-box" };

function runGit(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function createUpstreamWithManyFiles(fileCount) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "nexus-upstream-compare-test-"));
  const remote = join(temporaryDirectory, "upstream.git");
  const workingCopy = join(temporaryDirectory, "working-copy");

  try {
    execFileSync("git", ["init", "--bare", "--initial-branch=main", remote], { stdio: "ignore" });
    execFileSync("git", ["clone", remote, workingCopy], { stdio: "ignore" });
    runGit(workingCopy, "config", "user.name", "Upstream Compare Test");
    runGit(workingCopy, "config", "user.email", "upstream-compare-test@example.invalid");
    await writeFile(join(workingCopy, "baseline.txt"), "base\n");
    runGit(workingCopy, "add", "baseline.txt");
    runGit(workingCopy, "commit", "-m", "base release");
    const mergeBaseSha = runGit(workingCopy, "rev-parse", "HEAD");

    const changedPaths = [];
    await mkdir(join(workingCopy, "upstream"), { recursive: true });
    for (let index = 0; index < fileCount; index += 1) {
      const filename = `upstream/file-${String(index).padStart(3, "0")}.go`;
      changedPaths.push(filename);
      await writeFile(join(workingCopy, filename), `package upstream // ${index}\n`);
    }
    runGit(workingCopy, "add", "upstream");
    runGit(workingCopy, "commit", "-m", "release with many changed files");
    const headSha = runGit(workingCopy, "rev-parse", "HEAD");
    runGit(workingCopy, "push", "origin", "HEAD:refs/heads/main");
    return { temporaryDirectory, remote, mergeBaseSha, headSha, changedPaths };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

test("same upstream version skips the compare API", async () => {
  let calls = 0;
  const result = await compareRelease(entry, "1.14.2", "1.14.2", async () => {
    calls += 1;
  });

  assert.deepEqual(result, { files: [], truncated: false });
  assert.equal(calls, 0);
});

test("keeps all changed files returned below the cap without requesting a file page 2", async () => {
  const files = Array.from({ length: 261 }, (_, index) => ({
    filename: `core/file-${index}.go`,
    status: "modified",
    additions: 1,
    deletions: 0,
    changes: 1
  }));
  const urls = [];
  const result = await compareRelease(entry, "1.14.2", "1.14.3", async url => {
    urls.push(url);
    return { files };
  });

  assert.equal(urls.length, 1);
  assert.match(urls[0], /compare\/v1\.14\.2\.\.\.v1\.14\.3\?per_page=100&page=1$/);
  assert.equal(result.files.length, 261);
  assert.equal(result.files[260].filename, "core/file-260.go");
  assert.equal(result.truncated, false);
});

test("uses a complete local Git tree diff when Compare reaches 300 files", async t => {
  const fixture = await createUpstreamWithManyFiles(321);
  t.after(() => rm(fixture.temporaryDirectory, { recursive: true, force: true }));

  const cappedFiles = fixture.changedPaths.slice(0, 300).map(filename => ({ filename, status: "added" }));
  const urls = [];
  const result = await compareRelease(
    entry,
    "1.14.2",
    "1.14.3",
    async url => {
      urls.push(url);
      if (url.includes("/compare/")) {
        return { merge_base_commit: { sha: fixture.mergeBaseSha }, files: cappedFiles };
      }
      assert.match(url, /\/commits\/v1\.14\.3$/);
      return { sha: fixture.headSha };
    },
    args => readCompleteChangedFiles({ ...args, remoteUrl: fixture.remote })
  );

  assert.equal(urls.length, 2);
  assert.equal(result.truncated, false);
  assert.equal(result.files.length, 321);
  assert.deepEqual(result.files.map(file => file.filename).sort(), fixture.changedPaths.slice().sort());
  assert.ok(result.files.every(file => file.status === "added"));
});

test("fails closed if the local tree diff omits a path from the capped API list", async () => {
  await assert.rejects(
    compareRelease(
      entry,
      "1.14.2",
      "1.14.3",
      async url => url.includes("/compare/")
        ? {
            merge_base_commit: { sha: "a".repeat(40) },
            files: Array.from({ length: 300 }, (_, index) => ({ filename: index === 299 ? "missing.go" : `known-${index}.go` }))
          }
        : { sha: "b".repeat(40) },
      async () => [{ filename: "present.go", status: "added" }]
    ),
    /local upstream diff omitted a file from the capped API list/
  );
});

test("rejects compare responses without a changed-file list", async () => {
  await assert.rejects(
    compareRelease(entry, "1.14.2", "1.14.3", async () => ({ status: "ahead" })),
    /SagerNet\/sing-box: upstream comparison returned no valid file list/
  );
});
