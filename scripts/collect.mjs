#!/usr/bin/env node
// Collect every finished benchmark run: the per-step times each job recorded
// (its result.json artifact) and the job's own start and end from the GitHub
// API, which is what billing rounds up to whole minutes.
//
//   node scripts/collect.mjs            # needs gh, logged in
//
// Writes results/<workload>.json and prints a summary per runner label.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO = process.env.BENCH_REPO ?? "The-DevOps-Daily/gha-runner-benchmark";

// List price per minute for each runner label, USD, read 2026-10-10.
// GitHub: docs.github.com/en/billing/reference/actions-runner-pricing. Public
// repos run these for free; the price is what a private repo would pay. The
// 4-vCPU Ubuntu runner public repos get is priced as the 4-core larger runner.
// Build Hub: bitrise.io/pricing, rate from the monthly plan budget.
const PRICE_PER_MIN = {
  "github-ubuntu-24.04": 0.012,
  "github-macos-15": 0.062,
  "buildhub-linux-medium": 0.0125,
  "buildhub-m4-large": 0.03,
};

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

// Results come from artifacts, so the workload name is checked before it is
// used in a file path.
const WORKLOADS = new Set(["linux-prometheus", "macos-xcodebenchmark"]);
const byWorkload = {};
for (const workflow of ["bench-linux.yml", "bench-macos.yml"]) {
  const runs = JSON.parse(gh("run", "list", "-R", REPO, "--workflow", workflow, "--limit", "50", "--json", "databaseId,status,conclusion"));
  for (const run of runs.filter((r) => r.status === "completed")) {
    const jobs = JSON.parse(gh("api", `repos/${REPO}/actions/runs/${run.databaseId}/jobs?per_page=100`)).jobs;
    const dir = mkdtempSync(join(tmpdir(), "bench-"));
    try {
      gh("run", "download", String(run.databaseId), "-R", REPO, "-D", dir);
    } catch {
      continue; // no artifacts (failed before upload)
    }
    for (const name of readdirSync(dir)) {
      const file = join(dir, name, "result.json");
      if (!existsSync(file)) continue;
      const result = JSON.parse(readFileSync(file, "utf8"));
      if (!WORKLOADS.has(result.workload)) continue;
      const job = jobs.find((j) => j.name === `build (${result.run})`);
      const seconds = job ? (Date.parse(job.completed_at) - Date.parse(job.started_at)) / 1000 : null;
      (byWorkload[result.workload] ??= []).push({
        ...result,
        github_run: run.databaseId,
        job_seconds: seconds,
        billed_minutes: seconds === null ? null : Math.ceil(seconds / 60),
        runner_name: job?.runner_name ?? null,
      });
    }
  }
}

for (const [workload, rows] of Object.entries(byWorkload)) {
  rows.sort((a, b) => a.label.localeCompare(b.label) || a.github_run - b.github_run || a.run - b.run);
  writeFileSync(`results/${workload}.json`, `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`\n${workload}`);
  const labels = [...new Set(rows.map((r) => r.label))];
  for (const label of labels) {
    const rs = rows.filter((r) => r.label === label && !r.times.build_failed && !r.times.tests_failed);
    const price = PRICE_PER_MIN[label];
    const billed = median(rs.map((r) => r.billed_minutes));
    console.log(
      `  ${label.padEnd(24)} runs ${String(rs.length).padStart(2)}  build median ${median(rs.map((r) => r.times.build_s))?.toFixed(1)} s` +
        (rs[0]?.times.test_s !== undefined ? `  test median ${median(rs.map((r) => r.times.test_s)).toFixed(1)} s` : "") +
        `  job median ${median(rs.map((r) => r.job_seconds))?.toFixed(0)} s  billed ${billed} min` +
        (price ? `  = $${(billed * price).toFixed(3)} a run at list price` : "") +
        `  (${rs[0]?.machine.cpus} CPUs, ${rs[0]?.machine.model})`,
    );
  }
}
