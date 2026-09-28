import { readFile } from "node:fs/promises";
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

async function runCli() {
  const reportPath = process.argv[2] || ".nexus/upstream-report.json";
  const executed = new Set(process.argv.slice(3).filter(Boolean));

  if (executed.size === 0) {
    throw new Error("no executed gates supplied");
  }

  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const result = validateUpstreamReport(report, executed);

  if (!result.ok) {
    for (const failure of result.failures) console.error(failure);
    process.exitCode = 1;
  } else {
    console.log("Upstream candidate test plans are fully covered by executed automated gates.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
