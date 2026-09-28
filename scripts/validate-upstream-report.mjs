import { readFile } from "node:fs/promises";

const reportPath = process.argv[2] || ".nexus/upstream-report.json";
const executed = new Set(process.argv.slice(3).filter(Boolean));

if (executed.size === 0) {
  throw new Error("no executed gates supplied");
}

const report = JSON.parse(await readFile(reportPath, "utf8"));
if (!Array.isArray(report.kernels)) throw new Error("invalid upstream report: kernels[] missing");

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

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log("Upstream candidate test plans are fully covered by executed automated gates.");
}
