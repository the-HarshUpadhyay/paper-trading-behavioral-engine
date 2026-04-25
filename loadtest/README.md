# NevUp Track 1 — Load Testing

> **Spec:** `.planning/spec_ref.md` §7  
> - 200 concurrent trade-close events/sec, sustained 60s  
> - p95 write latency ≤ 150ms  
> - p95 read latency ≤ 200ms

---

## Quick Start

```powershell
# 1. System up
docker compose up --build -d

# 2. Generate JWT tokens (paste output into shell)
cd loadtest
node generate_tokens.js | Select-String '^\$env' | ForEach-Object { Invoke-Expression $_.Line }

# 3. Run
.\run.ps1

# 4. View report
start reports\load_test_report.html
```

```bash
# Bash equivalent
cd loadtest
source <(node generate_tokens.js | grep "^export")
bash run.sh
open reports/load_test_report.html
```

---

## Test Architecture

### Phases

| Phase | Duration | Rate | Purpose |
|---|---|---|---|
| Warmup | 10s | 0 → 210 req/s | Stabilize connections, avoid cold-start skew |
| Sustained | 60s | 210 req/s | Validate spec compliance |

### Traffic Mix

| Endpoint | Share | Spec Target |
|---|---|---|
| POST /trades | 80% | p95 ≤ 150ms |
| GET /users/:id/metrics | 20% | p95 ≤ 200ms |

### Validation Scenarios (low-frequency, non-disruptive)

| Scenario | Rate | Duration | Validates |
|---|---|---|---|
| Idempotency | 2/s | 30s | Duplicate tradeId → 200 |
| Multi-tenant | 1/s | 20s | Cross-tenant → 403 |
| Health monitor | 0.5/s | 70s | queueLag is integer, DB connected |

---

## Files

| File | Purpose |
|---|---|
| `k6-trade-close.js` | Production k6 script (ramping-arrival-rate) |
| `generate_tokens.js` | Pre-generates JWT tokens for all 10 seed users |
| `generate_html_report.js` | Converts k6 summary JSON → styled HTML report |
| `run.sh` | Bash runner with preflight + auto HTML generation |
| `run.ps1` | PowerShell runner with preflight + auto HTML generation |
| `k6.exe` | Portable k6 binary (not committed to git) |

---

## Thresholds

| Metric | Threshold | Spec Ref |
|---|---|---|
| `trade_write_latency` | p(95) < 150ms | §7 |
| `metrics_read_latency` | p(95) < 200ms | §7 |
| `http_reqs{scenario:sustained_load}` | rate ≥ 200/s | §7 |
| `trade_write_errors` | rate < 1% | §7 |
| `http_req_failed` | rate < 1% | §7 |
| `dropped_iterations` | count == 0 | capacity |

---

## Manual Run

```bash
# With JSON output
k6 run --out json=results.json --summary-export=summary.json k6-trade-close.js

# Generate HTML from summary
node generate_html_report.js summary.json load_test_report
```

---

## Interpreting Results

k6 prints a summary table. Key lines:

```
✓ trade_write_latency...: p(95)=XX.XXms     ← must be < 150ms
✓ metrics_read_latency..: p(95)=XX.XXms     ← must be < 200ms  
✓ http_reqs...............: XXXX  XXX.X/s   ← must be ≥ 200/s
✓ trade_write_errors.....: X.XX%            ← must be < 1%
✓ dropped_iterations.....: 0                ← must be 0
```

Each threshold shows ✓ (pass) or ✗ (fail).

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `TOKEN_0 not set` | Run `generate_tokens.js` and eval output |
| All 401s | Tokens expired — regenerate |
| All 403s | User IDs don't match seed data |
| API unreachable | `docker compose up --build -d` |
| k6 not found | Use `.\k6.exe` or install via package manager |
| High latency | Check Docker resource limits, PG pool size |
| Dropped iterations | Increase maxVUs or reduce target rate |
