// loadtest/generate_html_report.js — Convert k6 summary JSON to HTML report
// Usage: node generate_html_report.js <summary_file.json> [output_name]
// No external dependencies.

const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, 'reports');
const SPEC = { throughput: 200, p95Write: 150, p95Read: 200, errorRate: 0.01 };

function ms(v) { return v != null ? v.toFixed(2) : '—'; }
function pf(val, target, lt) {
  if (val == null) return '⬜';
  return lt ? (val < target ? '✅' : '❌') : (val >= target ? '✅' : '❌');
}

function extract(summary) {
  const m = summary.metrics || {};
  const dur = m.http_req_duration || {};
  const reqs = m.http_reqs || {};
  const wr = m.trade_write_latency || {};
  const rd = m.metrics_read_latency || {};
  const wErr = m.trade_write_errors || {};
  const checks = m.checks || {};
  const dropped = m.dropped_iterations || {};
  const trades = m.trades_created || {};

  return {
    totalReqs: reqs.count || 0,
    rps: reqs.rate || 0,
    p50: dur.med, p90: dur['p(90)'], p95: dur['p(95)'], p99: dur['p(99)'],
    avg: dur.avg, min: dur.min, max: dur.max,
    writeP95: wr['p(95)'], writeAvg: wr.avg, writeP50: wr.med,
    readP95: rd['p(95)'], readAvg: rd.avg, readP50: rd.med,
    writeErrorRate: wErr.rate ?? wErr.value ?? 0,
    checksPassed: checks.passes ?? 0,
    checksFailed: checks.fails ?? 0,
    droppedIterations: dropped.count ?? 0,
    tradesCreated: trades.count ?? 0,
  };
}

function html(title, d) {
  const rpsOk  = d.rps >= SPEC.throughput;
  const wp95Ok = d.writeP95 != null ? d.writeP95 < SPEC.p95Write : false;
  const rp95Ok = d.readP95 != null ? d.readP95 < SPEC.p95Read : true;
  const errOk  = d.writeErrorRate < SPEC.errorRate;
  const dropOk = d.droppedIterations === 0;
  const allOk  = rpsOk && wp95Ok && rp95Ok && errOk && dropOk;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NevUp — ${title}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0a0e1a;color:#c8d6e5;padding:2rem}
.wrap{max-width:920px;margin:0 auto}
h1{font-size:1.6rem;color:#f5f6fa;margin-bottom:.3rem}
.sub{color:#778ca3;margin-bottom:1.5rem;font-size:.9rem}
.badge{display:inline-block;padding:.6rem 1.2rem;border-radius:6px;font-weight:700;font-size:1rem;margin-bottom:1.8rem}
.badge.pass{background:#0a3d2e;border:1px solid #00b894;color:#55efc4}
.badge.fail{background:#3d0a0a;border:1px solid #d63031;color:#ff7675}
.card{background:#141a2e;border:1px solid #2d3436;border-radius:8px;padding:1.2rem 1.5rem;margin-bottom:1.2rem}
.card h2{font-size:.95rem;color:#dfe6e9;margin-bottom:.8rem;padding-bottom:.4rem;border-bottom:1px solid #2d3436;text-transform:uppercase;letter-spacing:.04em;font-weight:600}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:.4rem .6rem;color:#636e72;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em}
td{padding:.45rem .6rem;font-size:.9rem}
tr:nth-child(even) td{background:rgba(0,0,0,.15)}
.v{font-weight:600;font-variant-numeric:tabular-nums}
.ok{color:#55efc4}.no{color:#ff7675}.nt{color:#636e72}
.ref{margin-top:1.5rem;padding:.8rem 1rem;background:#141a2e;border-radius:6px;border-left:3px solid #0984e3;color:#636e72;font-size:.8rem}
.ts{color:#2d3436;font-size:.75rem;margin-top:.8rem}
</style>
</head>
<body>
<div class="wrap">
<h1>NevUp Track 1 — ${title}</h1>
<p class="sub">Warmup (10s ramp) + Sustained Load (60s) | 80% writes, 20% reads</p>
<div class="badge ${allOk?'pass':'fail'}">${allOk?'✅ ALL THRESHOLDS MET — SPEC COMPLIANT':'⚠️ THRESHOLD(S) EXCEEDED'}</div>

<div class="card"><h2>Spec Compliance</h2>
<table>
<tr><th>Requirement</th><th>Target</th><th>Actual</th><th>Result</th></tr>
<tr><td>Throughput</td><td class="v">≥ 200 req/s</td><td class="v">${d.rps.toFixed(1)} req/s</td><td class="${rpsOk?'ok':'no'}">${pf(d.rps,200,false)}</td></tr>
<tr><td>Write p95</td><td class="v">≤ 150ms</td><td class="v">${ms(d.writeP95)}ms</td><td class="${wp95Ok?'ok':'no'}">${pf(d.writeP95,150,true)}</td></tr>
<tr><td>Read p95</td><td class="v">≤ 200ms</td><td class="v">${ms(d.readP95)}ms</td><td class="${rp95Ok?'ok':'no'}">${pf(d.readP95,200,true)}</td></tr>
<tr><td>Error Rate</td><td class="v">&lt; 1%</td><td class="v">${(d.writeErrorRate*100).toFixed(2)}%</td><td class="${errOk?'ok':'no'}">${pf(d.writeErrorRate,0.01,true)}</td></tr>
<tr><td>Dropped Iterations</td><td class="v">0</td><td class="v">${d.droppedIterations}</td><td class="${dropOk?'ok':'no'}">${dropOk?'✅':'❌'}</td></tr>
</table></div>

<div class="card"><h2>Throughput</h2>
<table>
<tr><th>Metric</th><th>Value</th></tr>
<tr><td>Total HTTP Requests</td><td class="v">${d.totalReqs.toLocaleString()}</td></tr>
<tr><td>Requests/sec (avg)</td><td class="v">${d.rps.toFixed(1)}</td></tr>
<tr><td>Trades Created</td><td class="v">${d.tradesCreated.toLocaleString()}</td></tr>
<tr><td>Checks Passed</td><td class="v">${d.checksPassed.toLocaleString()}</td></tr>
<tr><td>Checks Failed</td><td class="v">${d.checksFailed}</td></tr>
</table></div>

<div class="card"><h2>Write Latency (POST /trades)</h2>
<table>
<tr><th>Percentile</th><th>Duration</th></tr>
<tr><td>avg</td><td class="v">${ms(d.writeAvg)}ms</td></tr>
<tr><td>p50</td><td class="v">${ms(d.writeP50)}ms</td></tr>
<tr><td><strong>p95</strong></td><td class="v"><strong>${ms(d.writeP95)}ms</strong></td></tr>
</table></div>

<div class="card"><h2>Read Latency (GET /metrics)</h2>
<table>
<tr><th>Percentile</th><th>Duration</th></tr>
<tr><td>avg</td><td class="v">${ms(d.readAvg)}ms</td></tr>
<tr><td>p50</td><td class="v">${ms(d.readP50)}ms</td></tr>
<tr><td><strong>p95</strong></td><td class="v"><strong>${ms(d.readP95)}ms</strong></td></tr>
</table></div>

<div class="card"><h2>Overall Latency (all endpoints)</h2>
<table>
<tr><th>Percentile</th><th>Duration</th></tr>
<tr><td>min</td><td class="v">${ms(d.min)}ms</td></tr>
<tr><td>avg</td><td class="v">${ms(d.avg)}ms</td></tr>
<tr><td>p50</td><td class="v">${ms(d.p50)}ms</td></tr>
<tr><td>p90</td><td class="v">${ms(d.p90)}ms</td></tr>
<tr><td>p95</td><td class="v">${ms(d.p95)}ms</td></tr>
<tr><td>p99</td><td class="v">${ms(d.p99)}ms</td></tr>
<tr><td>max</td><td class="v">${ms(d.max)}ms</td></tr>
</table></div>

<div class="card"><h2>Test Configuration</h2>
<table>
<tr><th>Parameter</th><th>Value</th></tr>
<tr><td>Executor</td><td class="v">ramping-arrival-rate</td></tr>
<tr><td>Warmup</td><td class="v">0 → 210 req/s over 10s</td></tr>
<tr><td>Sustained</td><td class="v">210 req/s for 60s</td></tr>
<tr><td>Traffic Mix</td><td class="v">80% writes / 20% reads</td></tr>
<tr><td>Validation</td><td class="v">idempotency + multi-tenant + health</td></tr>
</table></div>

<div class="ref"><strong>Spec:</strong> .planning/spec_ref.md §7 — 200 trade-close events/sec, sustained 60s, p95 write ≤ 150ms, p95 read ≤ 200ms</div>
<p class="ts">Generated: ${new Date().toISOString()}</p>
</div></body></html>`;
}

// ── Main ────────────────────────────────────────────────────────────────────

const inputFile = process.argv[2];
const outputName = process.argv[3] || 'load_test_report';

if (!inputFile) {
  console.log('Usage: node generate_html_report.js <summary.json> [output_name]');
  console.log('Example: node generate_html_report.js summary.json load_test_report');
  process.exit(1);
}

const filePath = path.isAbsolute(inputFile) ? inputFile : path.join(__dirname, inputFile);
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

const summary = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const data = extract(summary);
const outFile = path.join(REPORTS_DIR, `${outputName}.html`);
fs.writeFileSync(outFile, html('Load Test Report', data), 'utf8');
console.log(`[done] ${outFile}`);
