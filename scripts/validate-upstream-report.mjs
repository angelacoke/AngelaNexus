import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function validateUpstreamReport(report, executed = new Set()) {
  if (!report || !Array.isArray(report.kernels)) {
    return Object.freeze({
      ok: false,
      failures: ["invalid upstream report: kernels[] missing"]
    });
  }

  const failures = [];
  for (const candidate of report.kernels) {
    if (candidate.state !== "candidate") continue;
    const required = Array.isArray(candidate.testPlan?.checks) ? candidate.testPlan.checks : [];
    const missing = required.filter(check => !executed.has(check));
    if (missing.length > 0) {
      failures.push(candidate.kernel + ": missing executed checks: " + missing.join(", "));
    }
    if (candidate.release?.prerelease === true) {
      failures.push(candidate.kernel + ": prerelease release cannot become an update proposal");
    }
  }

  return Object.freeze({
    ok: failures.length === 0,
    failures
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
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const executed = await readExecutedEvidence(evidenceDirectory);
  const result = validateUpstreamReport(report, executed);

  if (!result.ok) {
    for (const failure of result.failures) console.error(failure);
    process.exitCode = 1;
  } else {
    console.log("Upstream candidate test plans are fully covered by recorded successful gate evidence.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
