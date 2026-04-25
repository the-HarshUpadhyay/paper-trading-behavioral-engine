# loadtest/run.ps1 - NevUp Track 1 Load Test Runner (PowerShell)
#
# Usage:
#   .\run.ps1
#
# Prerequisites:
#   1. docker compose up --build -d
#   2. node generate_tokens.js | Select-String '^\$env' | ForEach-Object { Invoke-Expression $_.Line }

$ErrorActionPreference = "Stop"

Write-Host "=== NevUp Track 1 - Load Test ===" -ForegroundColor Cyan
Write-Host "Phases: 10s warmup + 60s sustained at 210 req/s"
Write-Host "Mix: 80% POST /trades, 20% GET /metrics"
Write-Host ""

if (-not $env:TOKEN_0) {
    Write-Host "ERROR: JWT tokens not set. Run:" -ForegroundColor Red
    Write-Host "  node generate_tokens.js | Select-String '^\$env' | ForEach-Object { Invoke-Expression `$_.Line }"
    exit 1
}

try {
    $h = Invoke-RestMethod -Uri http://localhost:3000/health -ErrorAction Stop
    if ($h.status -ne "ok") { throw "unhealthy" }
} catch {
    Write-Host "ERROR: API not reachable. Run: docker compose up --build -d" -ForegroundColor Red
    exit 1
}

Write-Host "API healthy, tokens loaded" -ForegroundColor Green
Write-Host "Starting k6..."
Write-Host ""

$k6 = if (Get-Command k6 -ErrorAction SilentlyContinue) { "k6" } else { ".\k6.exe" }
& $k6 run --out json=results.json --summary-export=summary.json k6-trade-close.js

Write-Host ""
Write-Host "Generating HTML report..." -ForegroundColor Cyan
node generate_html_report.js summary.json load_test_report

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Cyan
Write-Host "Summary:     summary.json"
Write-Host "HTML report: reports\load_test_report.html"
