# gha-runner-benchmark

The same two GitHub Actions workloads, run many times on different runners, with every step timed and the billed minutes recorded.

```bash
gh workflow run bench-linux.yml -f runs=10
gh workflow run bench-macos.yml -f runs=10
node scripts/collect.mjs
```

## Workloads

- **Linux:** clone Prometheus v3.15.0, download its modules, build `prometheus` and `promtool`, and run `go test -short ./tsdb/...`, from a cold start with no cache. Network and CPU steps are timed apart.
- **macOS:** a clean build of [XcodeBenchmark](https://github.com/devMEremenko/XcodeBenchmark) at a pinned commit, a large iOS project made for comparing Macs.

Each job records the machine (CPU model, cores, memory, OS, Xcode) and writes `result.json`. `scripts/collect.mjs` adds each job's start and end from the GitHub API, which is what billing rounds up to whole minutes, and prices a run at each runner's list price.

## Running on another runner

Both workflows take the `runs-on` value as a JSON input, so the same file runs on GitHub-hosted runners or on a managed runner pool:

```bash
gh workflow run bench-linux.yml -f runner='["my-pool-label"]' -f label=my-runner -f runs=10
```

## Fairness rules

- Every run starts cold: no Actions cache, no warm DerivedData, a fresh clone.
- Runs are spread over different days and times, because shared runners are noisier at busy hours.
- The CPU model of every run is recorded. If a pool mixes machine types, the results say so.
- Medians, not single runs.

## License

MIT
