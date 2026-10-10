import test from "node:test";
import assert from "node:assert/strict";

import { compareRelease } from "../scripts/upstream-compare.js";

const entry = { repository: "SagerNet/sing-box" };

test("same upstream version skips the compare API", async () => {
  let calls = 0;
  const result = await compareRelease(entry, "1.14.2", "1.14.2", async () => {
    calls += 1;
  });

  assert.deepEqual(result, { files: [], truncated: false });
  assert.equal(calls, 0);
});

test("keeps all changed files returned on the first page without requesting a file page 2", async () => {
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

test("fails closed when GitHub reaches the 300-file comparison cap", async () => {
  const files = Array.from({ length: 300 }, (_, index) => ({ filename: `file-${index}.go` }));
  const result = await compareRelease(entry, "1.14.2", "1.14.3", async () => ({ files }));

  assert.equal(result.files.length, 300);
  assert.equal(result.truncated, true);
});

test("rejects compare responses without a changed-file list", async () => {
  await assert.rejects(
    compareRelease(entry, "1.14.2", "1.14.3", async () => ({ status: "ahead" })),
    /SagerNet\/sing-box: upstream comparison returned no file list/
  );
});
