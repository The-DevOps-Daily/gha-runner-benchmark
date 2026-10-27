# gha-runner-benchmark

The same two GitHub Actions workloads, run many times on different runners, with every step timed and the billed minutes recorded.

```bash
gh workflow run bench-linux.yml -f runs=10
gh workflow run bench-macos.yml -f runs=10
node scripts/collect.mjs
```

To spread runs over the day on several runners, one run per runner per round:

```bash
scripts/dispatch.sh --side github --rounds 10 --wait 1800
```

## Workloads

- **Linux:** clone Prometheus v3.15.0, download its modules, build `prometheus` and `promtool`, and run `go test -short ./tsdb/...`, from a cold start with no cache. Network and CPU steps are timed apart.
- **macOS:** a clean build of [XcodeBenchmark](https://github.com/devMEremenko/XcodeBenchmark) at a pinned commit, a large iOS project made for comparing Macs.

Each job records the machine (CPU model, cores, memory, OS, Xcode) and writes `result.json`. `scripts/collect.mjs` adds each job's queue time and its start and end from the GitHub API, which is what GitHub billing rounds up to whole minutes, and prices a run at each runner's list price. It writes `results/<workload>.json` and `results/<workload>.csv`.

## Running on another runner

Both workflows take the `runs-on` value as a JSON input, so the same file runs on GitHub-hosted runners or on a managed runner pool:

```bash
gh workflow run bench-linux.yml -f runner='["my-pool-label"]' -f label=my-runner -f runs=10
```

## Runner pairs

`runners.json` lists every runner `scripts/dispatch.sh` can use. Compare same vCPU first, then same price:

| Workload | GitHub-hosted | Build Hub | Why this pair |
|---|---|---|---|
| Linux | `ubuntu-24.04` in a public repo: 4 vCPU, 16 GB, free ($0.012/min as the private 4-core runner) | Linux Medium: 4 vCPU, 16 GB, $0.0125/min | Same vCPU and memory |
| macOS | `macos-15-xlarge`: M2 Pro, 5 vCPU, 14 GB, $0.102/min, paid even in public repos | M4 Large: 5 vCPU, 14 GB, $0.03/min | Same vCPU and memory |
| macOS | `macos-15`: M1, 3 vCPU, 7 GB, free in public repos ($0.062/min) | M4 XLarge: 10 vCPU, 28 GB, $0.06/min | About the same price per minute |
| macOS | `macos-15`: M1, 3 vCPU, 7 GB | M4 Large: 5 vCPU, 14 GB | The cheapest option on each side. Not the same size: say so with the result |
| Linux (optional) | 8-core larger runner, $0.022/min, paid | Linux Large: 8 vCPU, 32 GB, $0.025/min | Same vCPU |

Prices are list prices from docs.github.com/en/billing/reference/actions-runner-pricing and bitrise.io/pricing (Build Hub rate from the monthly plan budget), checked 2026-10-14. The paid GitHub rows need a Team plan and are skipped unless `--include-paid` is given. The 8-core label in `runners.json` is a placeholder: use the name of the larger runner you create in the organization settings.

## The Build Hub side

The Build Hub rows need a Build Hub account, which we do not have yet. When it exists:

1. Install the Bitrise Build Hub GitHub App for this repository only.
2. Create one machine pool per row, named `bench-linux-medium`, `bench-linux-large`, `bench-m4-large` and `bench-m4-xlarge`, with "Minimum" warm machines set to 0, so both sides start cold. Bitrise adds the label `bitrise-runner-<pool name>`.
3. This repository is public, so the runner group needs "Allow public repositories". Limit the group to this repository. The workflows only start on `schedule` and `workflow_dispatch`, never on `pull_request`, so a fork cannot run code on the pool.
4. Run both sides in the same days, for example `scripts/dispatch.sh --rounds 10`, because runner images and shared hosts change over time.
5. Check each run's CPU model in the results. Bitrise documents that one machine ID can cover more than one Mac generation.

Build Hub's billing rounding is not published yet, so `collect.mjs` rounds its jobs up to whole minutes like GitHub's until Bitrise confirms the rule.

## Fairness rules

- Every run starts cold: no Actions cache, no warm DerivedData, a fresh clone.
- Runs are spread over different days and times, because shared runners are noisier at busy hours.
- The CPU model of every run is recorded. If a pool mixes machine types, the results say so.
- Medians, not single runs.

## License

MIT
