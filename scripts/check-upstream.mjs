import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { UpstreamKernelRegistry } from "../src/core/kernel-registry.js";
import { createKernelUpdateCandidate } from "../src/core/kernel-update-manager.js";

const args = process.argv.slice(2);
const propose = args.includes("--propose");
const reportIndex = args.indexOf("--write-report");
const reportPath = reportIndex >= 0 ? args[reportIndex + 1] : null;
const apiHeaders = {
  accept: "application/vnd.github+json",
  "user-agent": "AngelaNexus-upstream-sync",
  ...(process.env.GITHUB_TOKEN ? { authorization: "Bearer " + process.env.GITHUB_TOKEN } : {})
};

async function github(url) {
  const response = await fetch(url, { headers: apiHeaders });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${url}`);
  return response.json();
}

async function getLatest(entry) {
  const release = await github(`https://api.github.com/repos/${entry.repository}/releases/latest`);
  return {
    tag: String(release.tag_name || "").replace(/^v/, ""),
    publishedAt: release.published_at || release.created_at || null,
    prerelease: release.prerelease === true,
    htmlUrl: release.html_url || null,
    body: String(release.body || "")
  };
}

async function compareRelease(entry, configured, upstream) {
  if (!configured || !upstream || configured === upstream) return [];
  const result = await github(
    `https://api.github.com/repos/${entry.repository}/compare/v${encodeURIComponent(configured)}...v${encodeURIComponent(upstream)}`
  );
  return Array.isArray(result.files) ? result.files.map(file => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes
  })) : [];
}

function replaceStable(source, kernel, version) {
  const marker = kernel === "sing-box"
    ? '"sing-box": Object.freeze({'
    : kernel + ': Object.freeze({';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error("cannot locate registry entry for " + kernel);
  const end = source.indexOf("\n  })", start);
  if (end < 0) throw new Error("cannot locate end of registry entry for " + kernel);
  const block = source.slice(start, end);
  const stable = /stable:\s*"[^"]+"/;
  if (!stable.test(block)) throw new Error("cannot locate stable version for " + kernel);
  const nextBlock = block.replace(stable, 'stable: "' + version + '"');
  return source.slice(0, start) + nextBlock + source.slice(end);
}

const report = {
  generatedAt: new Date().toISOString(),
  mode: propose ? "propose" : "check",
  kernels: [],
  updateAvailable: false,
  registryChanged: false
};

let registrySource = null;
if (propose) registrySource = await readFile(new URL("../src/core/kernel-registry.js", import.meta.url), "utf8");

for (const [kernel, entry] of Object.entries(UpstreamKernelRegistry)) {
  const release = await getLatest(entry);
  const changedFiles = await compareRelease(entry, entry.stable, release.tag);
  const candidate = createKernelUpdateCandidate({
    kernel,
    configuredVersion: entry.stable,
    upstreamVersion: release.tag,
    release: {
      tag: release.tag,
      publishedAt: release.publishedAt,
      prerelease: release.prerelease
    },
    changedFiles
  });
  const item = {
    ...candidate,
    releaseUrl: release.htmlUrl,
    releaseNotes: release.body.slice(0, 4000)
  };
  report.kernels.push(item);

  if (propose && candidate.state === "candidate") {
    registrySource = replaceStable(registrySource, kernel, release.tag);
    report.registryChanged = true;
  }
  if (candidate.state === "candidate") report.updateAvailable = true;

  console.log(`${kernel}: configured=${entry.stable} upstream=${release.tag} state=${candidate.state} risk=${candidate.risk}`);
}

if (propose && report.registryChanged) {
  await writeFile(new URL("../src/core/kernel-registry.js", import.meta.url), registrySource);
  console.log("Prepared kernel registry candidate updates. No runtime activation or merge is performed.");
}

if (reportPath) {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\\n");
}

if (report.updateAvailable && !propose) process.exitCode = 2;
