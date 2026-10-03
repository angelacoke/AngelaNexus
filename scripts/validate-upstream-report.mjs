import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function validateUpstreamReport(report, executed = new Set(), options = {}) {
  if (!report || !Array.isArray(report.kernels)) {
    return Object.freeze({
      ok: false,
      failures: ["invalid upstream report: kernels[] missing"]
    });
  }

  const allowManualGates = options.allowManualGates === true;
  const manualGates = new Set(["security-review", "user-approval"]);
  const failures = [];
  for (const candidate of report.kernels) {
    if (candidate.state !== "candidate") continue;
    const required = Array.isArray(candidate.testPlan?.checks) ? candidate.testPlan.checks : [];
    const missing = required.filter(check => !executed.has(check) && !(allowManualGates && manualGates.has(check)));
    if (missing.length > 0) {
      failures.push(candidate.kernel + ": missing executed checks: " + missing.join(", "));
    }
    if (candidate.release?.prerelease === true) {
      failures.push(candidate.kernel + ": prerelease release cannot become an update proposal");
    }
    if (candidate.provenance?.ok !== true) {
      failures.push(candidate.kernel + ": release provenance is missing or unverified");
    }
  }

  return Object.freeze({
    ok: failures.length === 0,
    failures,
    pendingManualGates: allowManualGates ? ["security-review", "user-approval"] : []
  });
}

async function readExecutedEvidence(directory) {
  const names = await readdir(directory, { withFileTypes: true });
  const executed = new Set();
  for (const entry of names) {
    if (!entry.isFile() || !entry.name.endsWith(".ok")) continue;
    const gate = entry.name.slice(0, -3);
    if (!gate) continue;
    const content = (await readFile(directory + "/" + entry.name, "utf8")).trim();
    if (content !== "success") {
      throw new Error("invalid gate evidence: " + entry.name);
    }
    executed.add(gate);
  }
  return executed;
}

async function runCli() {
  const reportPath = process.argv[2] || ".nexus/upstream-report.json";
  const evidenceDirectory = process.argv[3] || ".nexus/gates";
  const allowManualGates = process.argv.includes("--allow-manual-gates");
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const executed = await readExecutedEvidence(evidenceDirectory);
  const result = validateUpstreamReport(report, executed, { allowManualGates });

  if (!result.ok) {
    for (const failure of result.failures) console.error(failure);
    process.exitCode = 1;
  } else {
    console.log("Upstream candidate test plans are covered by recorded automated evidence; manual gates remain required before promotion.");
    if (result.pendingManualGates.length > 0) console.log("Pending manual gates: " + result.pendingManualGates.join(", "));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
