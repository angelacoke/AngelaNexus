import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_COMPARE_FILES = 300;
const GIT_STATUS = Object.freeze({
  A: "added",
  C: "copied",
  D: "removed",
  M: "modified",
  R: "renamed",
  T: "changed",
  U: "changed",
  X: "changed",
  B: "changed"
});

function assertCommitSha(value, label) {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value)) {
    throw new Error("upstream comparison did not provide a valid " + label + " commit SHA");
  }
  return value;
}

function upstreamGitUrl(repository) {
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("upstream comparison has an invalid repository name");
  }
  return `https://github.com/${repository}.git`;
}

function parseNameStatus(output) {
  const fields = output.split("\0");
  if (fields.at(-1) === "") fields.pop();
  if (fields.length % 2 !== 0) throw new Error("local upstream diff returned an incomplete name/status record");

  const files = [];
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index];
    const filename = fields[index + 1];
    if (status.length !== 1 || !Object.hasOwn(GIT_STATUS, status) || !filename) {
      throw new Error("local upstream diff returned an invalid name/status record");
    }
    files.push({ filename, status: GIT_STATUS[status] });
  }
  return files;
}

/**
 * Compare the exact merge-base and head trees locally. GitHub's JSON Compare
 * endpoint caps its changed-file array at 300 entries, so it is not used for
 * the full list once that cap is reached.
 */
export async function readCompleteChangedFiles({ repository, mergeBaseSha, headSha, remoteUrl } = {}) {
  const base = assertCommitSha(mergeBaseSha, "merge-base");
  const head = assertCommitSha(headSha, "head");
  const remote = remoteUrl || upstreamGitUrl(repository);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "nexus-upstream-diff-"));
  const gitDirectory = join(temporaryDirectory, "repository.git");
  const runGit = args => execFileSync(
    "git",
    [`--git-dir=${gitDirectory}`, ...args],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }
  );

  try {
    execFileSync("git", ["init", "--bare", "--quiet", gitDirectory], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"]
    });
    runGit(["fetch", "--no-tags", "--filter=blob:none", "--depth=1", remote, base, head]);
    runGit(["cat-file", "-e", `${base}^{commit}`]);
    runGit(["cat-file", "-e", `${head}^{commit}`]);
    const output = runGit(["diff", "--name-status", "-z", "--no-renames", "--no-ext-diff", base, head]);
    return parseNameStatus(output);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

/**
 * Read changed files from GitHub's Compare API, fetching a complete local tree
 * diff if its JSON file list reaches GitHub's 300-file response cap.
 */
export async function compareRelease(entry, configured, upstream, github, readGitFiles = readCompleteChangedFiles) {
  if (!configured || !upstream || configured === upstream) {
    return { files: [], truncated: false };
  }

  const url = `https://api.github.com/repos/${entry.repository}/compare/v${encodeURIComponent(configured)}...v${encodeURIComponent(upstream)}?per_page=100&page=1`;
  const result = await github(url);
  if (!Array.isArray(result?.files) || result.files.some(file => typeof file?.filename !== "string")) {
    throw new Error(entry.repository + ": upstream comparison returned no valid file list");
  }

  if (result.files.length >= MAX_COMPARE_FILES) {
    const mergeBaseSha = assertCommitSha(result.merge_base_commit?.sha, "merge-base");
    const headCommit = await github(
      `https://api.github.com/repos/${entry.repository}/commits/v${encodeURIComponent(upstream)}`
    );
    const headSha = assertCommitSha(headCommit?.sha, "head");
    const files = await readGitFiles({ repository: entry.repository, mergeBaseSha, headSha });
    if (!Array.isArray(files)) throw new Error(entry.repository + ": local upstream diff returned no file list");

    const completeNames = new Set(files.map(file => file?.filename).filter(name => typeof name === "string"));
    const omitted = result.files.find(file => !completeNames.has(file.filename));
    if (omitted) {
      throw new Error(entry.repository + ": local upstream diff omitted a file from the capped API list");
    }
    return { files, truncated: false };
  }

  return {
    files: result.files.map(file => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes
    })),
    truncated: false
  };
}
