#!/bin/bash
# loadtest/run.sh - NevUp Track 1 Load Test Runner
#
# Usage:
#   bash run.sh                    # run test + generate HTML report
#
# Prerequisites:
#   1. docker compose up --build -d
#   2. source <(node generate_tokens.js | grep "^export")

set -euo pipefail

echo "=== NevUp Track 1 — Load Test ==="
echo "Phases: 10s warmup + 60s sustained at 210 req/s"
echo "Mix: 80% POST /trades, 20% GET /metrics"
echo ""

if [ -z "${TOKEN_0:-}" ]; then
  echo "ERROR: JWT tokens not set. Run:"
  echo "   source <(node generate_tokens.js | grep '^export')"
  exit 1
fi

if ! curl -sf http://localhost:3000/health > /dev/null 2>&1; then
  echo "ERROR: API not reachable. Run: docker compose up --build -d"
  exit 1
fi

echo "API healthy, tokens loaded"
echo "Starting k6..."
echo ""

k6 run \
  --out json=results.json \
  --summary-export=summary.json \
  k6-trade-close.js

echo ""
echo "Generating HTML report..."
node generate_html_report.js summary.json load_test_report

echo ""
echo "=== Done ==="
echo "Summary:     summary.json"
echo "HTML report: reports/load_test_report.html"
