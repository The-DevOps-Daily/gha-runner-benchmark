#!/usr/bin/env node
// Pipeline time for every finished bench-mobile-pipeline run: from the moment
// the run was created to the end of its last job, so queueing and machine
// start-up count, as they do for a developer waiting on a pull request.
//
//   node scripts/pipeline.mjs            # needs gh, logged in
//
// Writes results/mobile-pipeline.json and prints one line per run and the
// median per side.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const REPO = process.env.BENCH_REPO ?? "The-DevOps-Daily/gha-runner-benchmark";
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
const seconds = (from, to) => (Date.parse(to) - Date.parse(from)) / 1000;

const runs = JSON.parse(gh("run", "list", "-R", REPO, "--workflow", "bench-mobile-pipeline.yml", "--limit", "50", "--json", "databaseId,status,conclusion,createdAt"));
const rows = [];
for (const run of runs.filter((r) => r.status === "completed")) {
  const jobs = JSON.parse(gh("api", `repos/${REPO}/actions/runs/${run.databaseId}/jobs?per_page=100`)).jobs;
  // The work jobs, not the small plan jobs that pick the run count.
  const work = jobs.filter((j) => !j.name.endsWith("/ plan"));
  const ios = work.find((j) => j.name.startsWith("ios /"));
  // GitHub-hosted runners are named "GitHub Actions <n>"; Build Hub machines "vm-pool-...".
  const side = ios?.runner_name?.startsWith("GitHub Actions") ? "github" : "buildhub";
  const end = work.map((j) => j.completed_at).sort().at(-1);
  rows.push({
    github_run: run.databaseId,
    side,
    conclusion: run.conclusion,
    created_at: run.createdAt,
    pipeline_seconds: seconds(run.createdAt, end),
    jobs: work.map((j) => ({
      name: j.name,
      runner: j.runner_name,
      queue_seconds: seconds(j.created_at, j.started_at),
      job_seconds: seconds(j.started_at, j.completed_at),
      conclusion: j.conclusion,
    })),
  });
}

rows.sort((a, b) => a.side.localeCompare(b.side) || a.github_run - b.github_run);
writeFileSync("results/mobile-pipeline.json", `${JSON.stringify(rows, null, 2)}\n`);
for (const r of rows) {
  const jobs = r.jobs.map((j) => `${j.name.split(" /")[0]} ${Math.round(j.job_seconds)}s (queue ${Math.round(j.queue_seconds)}s)`).join(", ");
  console.log(`${r.side.padEnd(9)} ${r.github_run} ${r.conclusion.padEnd(8)} pipeline ${(r.pipeline_seconds / 60).toFixed(1)} min  ${jobs}`);
}
for (const side of ["github", "buildhub"]) {
  const ok = rows.filter((r) => r.side === side && r.conclusion === "success");
  if (ok.length) console.log(`${side}: median pipeline ${(median(ok.map((r) => r.pipeline_seconds)) / 60).toFixed(1)} min over ${ok.length} runs`);
}
