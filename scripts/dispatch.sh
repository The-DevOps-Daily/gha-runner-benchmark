#!/usr/bin/env bash
# Queue benchmark runs round-robin across the runners in runners.json, one run
# per runner per round, so every runner sees the same hours of the day.
#
#   scripts/dispatch.sh --rounds 10 --wait 1800            # GitHub and Build Hub
#   scripts/dispatch.sh --side github --rounds 3           # GitHub only
#   scripts/dispatch.sh --include-paid                     # also the paid larger runners
#   scripts/dispatch.sh --workflow bench-ios-app.yml       # one workload only
#
# Paid GitHub larger runners (macos-15-xlarge, 8-core Linux) are skipped unless
# --include-paid is given: they are billed even in a public repository.
set -euo pipefail
cd "$(dirname "$0")/.."

ROUNDS=1 WAIT=1800 SIDE=all PAID=false WORKFLOW=""
while [ $# -gt 0 ]; do
  case "$1" in
    --rounds) ROUNDS=$2; shift 2 ;;
    --wait) WAIT=$2; shift 2 ;;
    --side) SIDE=$2; shift 2 ;;
    --include-paid) PAID=true; shift ;;
    --workflow) WORKFLOW=$2; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

mapfile -t ROWS < <(jq -c --arg side "$SIDE" --argjson paid "$PAID" --arg wf "$WORKFLOW" \
  '.[] | select($side == "all" or .side == $side) | select($paid or (.paid // false) == false) | select($wf == "" or .workflow == $wf)' runners.json)
[ ${#ROWS[@]} -gt 0 ] || { echo "no runners selected" >&2; exit 1; }

for round in $(seq 1 "$ROUNDS"); do
  for row in "${ROWS[@]}"; do
    wf=$(jq -r .workflow <<<"$row"); label=$(jq -r .label <<<"$row"); runner=$(jq -r .runner <<<"$row")
    task=$(jq -r '.task // empty' <<<"$row")
    echo "round $round: $label ($wf${task:+ $task})"
    gh workflow run "$wf" -f runs=1 -f runner="$runner" -f label="$label" ${task:+-f task="$task"}
    sleep 5
  done
  [ "$round" -lt "$ROUNDS" ] && sleep "$WAIT"
done
