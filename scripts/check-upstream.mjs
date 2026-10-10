import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { UpstreamKernelRegistry } from "../src/core/kernel-registry.js";
import { createKernelUpdateCandidate } from "../src/core/kernel-update-manager.js";
import { selectReleaseChannels, summarizeRelease } from "../src/core/upstream-release.js";
import { compareRelease } from "./upstream-compare.js";

const args = process.argv.slice(2);
const propose = args.includes("--propose");
const verifyPipeline = args.includes("--verify-pipeline");
const reportIndex = args.indexOf("--write-report");
const reportPath = reportIndex >= 0 ? args[reportIndex + 1] : null;
const apiHeaders = {
  accept: "application/vnd.github+json",
  "user-agent": "AngelaNexus-upstream-sync",
  ...(process.env.GITHUB_TOKEN ? { authorization: "Bearer " + process.env.GITHUB_TOKEN } : {})
};

async function github(url, { attempts = 3 } = {}) {
  let lastStatus = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: apiHeaders });
      if (response.ok) return response.json();
      lastStatus = response.status;
      if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === attempts) {
        throw new Error(`GitHub API ${response.status}: ${url}`);
      }
    } catch (error) {
      if (attempt === attempts) throw error;
      if (error?.name !== "TypeError" && lastStatus === null) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
  }
  throw new Error(`GitHub API ${lastStatus || "request failure"}: ${url}`);
}

async function getReleaseChannels(entry) {
  const releases = await github(
    `https://api.github.com/repos/${entry.repository}/releases?per_page=100&page=1`
  );
  if (!Array.isArray(releases)) {
    throw new Error(entry.repository + ": upstream releases endpoint returned no release list");
  }

  const channels = selectReleaseChannels(releases);
  if (!channels.stable) {
    throw new Error(entry.repository + ": no published stable release found");
  }

  return {
    stable: summarizeRelease(channels.stable, { repository: entry.repository }),
    preview: summarizeRelease(channels.preview, { repository: entry.repository })
  };
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
  mode: verifyPipeline ? "verify-pipeline" : (propose ? "propose" : "check"),
  kernels: [],
  updateAvailable: false,
  registryChanged: false,
  verificationFailures: []
};

let registrySource = null;
if (propose) registrySource = await readFile(new URL("../src/core/kernel-registry.js", import.meta.url), "utf8");

for (const [kernel, entry] of Object.entries(UpstreamKernelRegistry)) {
  const channels = await getReleaseChannels(entry);
  const release = channels.stable;
  const comparison = await compareRelease(entry, entry.stable, release.tag, github);
  if (comparison.truncated) {
    throw new Error(kernel + ": GitHub Compare API reached its 300-file response limit; refusing potentially incomplete impact analysis");
  }
  const changedFiles = comparison.files;
  const candidate = createKernelUpdateCandidate({
    kernel,
    configuredVersion: entry.stable,
    upstreamVersion: release.tag,
    release,
    changedFiles,
    expectedRepository: entry.repository
  });
  const reportCandidate = verifyPipeline && candidate.state === "current"
    ? candidate.provenance?.ok === true
      ? { ...candidate, state: "candidate" }
      : { ...candidate, state: "conformance-failed" }
    : candidate;
  const item = {
    ...reportCandidate,
    releaseUrl: release.htmlUrl,
    releaseNotes: release.body.slice(0, 4000),
    previewRelease: channels.preview
  };
  report.kernels.push(item);

  if (propose && candidate.state === "candidate") {
    registrySource = replaceStable(registrySource, kernel, release.tag);
    report.registryChanged = true;
  }
  if (candidate.state === "candidate") report.updateAvailable = true;
  if (candidate.state === "conformance-failed") {
    report.verificationFailures.push(kernel + ": release provenance verification failed");
  }

  const previewText = channels.preview ? ` preview=${channels.preview.tag}` : "";
  console.log(`${kernel}: configured=${entry.stable} stable=${release.tag}${previewText} state=${candidate.state} risk=${candidate.risk}`);
}

if (propose && report.registryChanged) {
  await writeFile(new URL("../src/core/kernel-registry.js", import.meta.url), registrySource);
  console.log("Prepared kernel registry candidate updates. No runtime activation or merge is performed.");
}

if (reportPath) {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
}

if (report.verificationFailures.length > 0) {
  for (const failure of report.verificationFailures) console.error(failure);
  process.exitCode = 1;
} else if (report.updateAvailable && !propose) {
  process.exitCode = 2;
}
