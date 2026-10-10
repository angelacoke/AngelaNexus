import test from "node:test";
import assert from "node:assert/strict";
import {
  GITHUB_COMPARE_FILE_LIMIT,
  normalizeGitHubComparisonFiles
} from "../scripts/upstream-compare.js";

function changedFiles(count) {
  return Array.from({ length: count }, (_, index) => ({
    filename: `src/file-${index}.js`,
    status: "modified",
    additions: 1,
    deletions: 0,
    changes: 1
  }));
}

test("accepts a complete compare response larger than the requested page size", () => {
  const result = normalizeGitHubComparisonFiles("SagerNet/sing-box", {
    files: changedFiles(261)
  });

  assert.equal(result.files.length, 261);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.files[0], {
    filename: "src/file-0.js",
    status: "modified",
    additions: 1,
    deletions: 0,
    changes: 1
  });
});

test("fails closed when the GitHub comparison file ceiling is reached", () => {
  const result = normalizeGitHubComparisonFiles("SagerNet/sing-box", {
    files: changedFiles(GITHUB_COMPARE_FILE_LIMIT)
  });

  assert.equal(result.files.length, GITHUB_COMPARE_FILE_LIMIT);
  assert.equal(result.truncated, true);
});

test("rejects compare responses without a file list", () => {
  assert.throws(
    () => normalizeGitHubComparisonFiles("SagerNet/sing-box", { status: "ahead" }),
    /SagerNet\/sing-box: upstream comparison returned no file list/
  );
});
