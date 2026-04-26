#!/usr/bin/env bash
# loadtest/run.sh — Orchestrate the full load test pipeline
# Usage: K6_WEB_DASHBOARD=true TEST_MODE=spec ./loadtest/run.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORTS_DIR="$SCRIPT_DIR/reports"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${CYAN}[loadtest]${NC} $*"; }
ok()   { echo -e "${GREEN}[  ✅  ]${NC} $*"; }
warn() { echo -e "${YELLOW}[  ⚠️  ]${NC} $*"; }
fail() { echo -e "${RED}[  ❌  ]${NC} $*"; exit 1; }

# ── Step 0: Environment Verification ─────────────────────────────────────────

log "Step 0: Verifying environment..."

command -v docker >/dev/null 2>&1    || fail "docker not found"
command -v k6 >/dev/null 2>&1        || fail "k6 not found"
command -v node >/dev/null 2>&1      || fail "node not found"

echo ""
echo -e "${BOLD}Environment:${NC}"
docker --version
docker compose version 2>/dev/null || docker-compose version
node -v
k6 version
echo ""

# ── Step 1: Clean Start ──────────────────────────────────────────────────────

log "Step 1: Clean start — bringing down existing containers..."
cd "$PROJECT_DIR"
docker compose down -v 2>/dev/null || true
sleep 2

log "Building and starting services..."
docker compose up --build -d

log "Waiting for services to become healthy..."
MAX_WAIT=120
WAITED=0
while true; do
  # Check if API is responding
  if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
    ok "API is healthy"
    break
  fi

  WAITED=$((WAITED + 2))
  if [ "$WAITED" -ge "$MAX_WAIT" ]; then
    fail "Services failed to become healthy within ${MAX_WAIT}s"
  fi

  sleep 2
  echo -n "."
done

# Show health response
echo ""
log "Health check response:"
curl -s http://localhost:3000/health | python3 -m json.tool 2>/dev/null || curl -s http://localhost:3000/health
echo ""

# ── Step 2: Token Setup ──────────────────────────────────────────────────────

log "Step 2: Generating JWT tokens for all seed users..."
cd "$PROJECT_DIR"
node loadtest/generate_tokens.js > /dev/null 2>&1
ok "Tokens generated → loadtest/users.json"

# Verify tokens are valid by testing one
FIRST_TOKEN=$(python3 -c "import json; d=json.load(open('loadtest/users.json')); print(d[0]['token'])" 2>/dev/null)
FIRST_USER=$(python3 -c "import json; d=json.load(open('loadtest/users.json')); print(d[0]['userId'])" 2>/dev/null)

log "Smoke test: GET /users/${FIRST_USER}/metrics with token..."
SMOKE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${FIRST_TOKEN}" \
  "http://localhost:3000/users/${FIRST_USER}/metrics?from=2025-01-01T00:00:00Z&to=2025-03-31T23:59:59Z&granularity=daily")

if [ "$SMOKE_STATUS" = "200" ]; then
  ok "Smoke test passed (HTTP ${SMOKE_STATUS})"
else
  warn "Smoke test returned HTTP ${SMOKE_STATUS} (may still work under load)"
fi

# Smoke test write
log "Smoke test: POST /trades..."
TRADE_ID=$(python3 -c "import uuid; print(str(uuid.uuid4()))")
SMOKE_WRITE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:3000/trades \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${FIRST_TOKEN}" \
  -d "{
    \"tradeId\": \"${TRADE_ID}\",
    \"userId\": \"${FIRST_USER}\",
    \"sessionId\": \"4f39c2ea-8687-41f7-85a0-1fafd3e976df\",
    \"asset\": \"AAPL\",
    \"assetClass\": \"equity\",
    \"direction\": \"long\",
    \"entryPrice\": 150.00,
    \"exitPrice\": 155.00,
    \"quantity\": 100,
    \"entryAt\": \"2025-01-15T10:00:00Z\",
    \"exitAt\": \"2025-01-15T14:00:00Z\",
    \"status\": \"closed\",
    \"outcome\": \"win\",
    \"pnl\": 500.00,
    \"planAdherence\": 4,
    \"emotionalState\": \"calm\",
    \"entryRationale\": \"Smoke test trade\",
    \"revengeFlag\": false
  }")

if [ "$SMOKE_WRITE" = "200" ]; then
  ok "Write smoke test passed (HTTP ${SMOKE_WRITE})"
else
  warn "Write smoke test returned HTTP ${SMOKE_WRITE}"
fi

# ── Step 3: Execute k6 Load Test ─────────────────────────────────────────────

mkdir -p "$REPORTS_DIR"

log "Step 3: Executing k6 load test..."
echo ""
echo -e "${BOLD}════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  k6 Load Test — NevUp Track 1 Spec Validation${NC}"
echo -e "${BOLD}════════════════════════════════════════════════════${NC}"
echo ""

# Set k6 dashboard env vars
export K6_WEB_DASHBOARD="${K6_WEB_DASHBOARD:-true}"
export K6_WEB_DASHBOARD_EXPORT="${REPORTS_DIR}/spec_dashboard.html"

cd "$PROJECT_DIR"
k6 run loadtest/spec.js

echo ""
ok "Load test complete!"

# ── Step 4: Results ──────────────────────────────────────────────────────────

if [ -f "$REPORTS_DIR/spec_results.json" ]; then
  log "Results saved to:"
  echo "  → loadtest/reports/spec_results.json"
fi

if [ -f "$REPORTS_DIR/spec_dashboard.html" ]; then
  echo "  → loadtest/reports/spec_dashboard.html"
fi

echo ""
log "Done. Review the k6 web dashboard for detailed metrics."
