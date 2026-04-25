# NevUp Track 1 — Bugfix Workflow

> **How we fix bugs**: Same discipline as the build phases. Audit → Plan → Fix → Verify → Commit.  
> **Source**: [definitive_audit.md](file:///C:/Users/harsh/.gemini/antigravity/brain/344eb425-05d5-470c-99c5-6f87e9f42e26/definitive_audit.md)

---

## Session Startup Protocol

Every bugfix session, do this FIRST:

```
1. READ  .planning/bugfix/task.md       → What's fixed? What's next?
2. READ  .planning/bugfix/context.md    → Bug details + exact code refs
3. CHECK docker compose ps              → Are containers running?
4. CHECK git log -1                      → Last commit?
```

**Never start fixing without knowing which bug you're on.**

---

## Bugfix Execution Workflow

### Step 1: Identify Current Bug

Check `task.md` for the first uncompleted `[ ]` item. That's what you fix next.

### Step 2: Fix (One Bug at a Time)

```
┌─────────────────────────────────────┐
│  1. Read bug context in context.md  │
│  2. Open the exact file(s) listed   │
│  3. Apply the fix                   │
│  4. Smoke test (curl / manual)      │
│  5. Update task.md: [ ] → [x]       │
│  6. Write fix report (see below)    │
│  7. Move to next bug                │
└─────────────────────────────────────┘
```

### Step 2.5: Write Fix Report

After every completed fix, create a report in `.planning/bugfix/reports/`:

**File naming**: `fix{N}_{shortname}_report.md`  
**Examples**: `fix1_queuelag_report.md`, `fix2_publish_retry_report.md`

**Report template**:
```markdown
# Fix N: {Title} — Report

> **Status**: ✅ COMPLETE
> **Started**: {timestamp}
> **Completed**: {timestamp}
> **Duration**: {time}

## Bug Summary
| Field | Value |
|---|---|
| **Severity** | 🔴/🟠 |
| **File** | {file path} |
| **Lines Changed** | {range} |
| **Root Cause** | {one sentence} |
| **Spec Requirement** | {exact spec ref} |

## What Was Wrong
{code block showing the broken code}

## What Was Fixed
{code block showing the fix}

## Verification
| Test | Expected | Actual | Status |
|---|---|---|---|
| ... | ... | ... | ✅/❌ |

## Risk Assessment
| Risk | Mitigation |
|---|---|
| ... | ... |
```

**Rule**: No fix is "done" without a report. Reports are the audit trail.

Before moving from Tier 1 → Tier 2, run ALL tier gate checks:

| Tier | Gate Check |
|---|---|
| Tier 1: MUST FIX | `curl /health` → `queueLag` is integer. `npm test` → all green. Seed data has no null P&L for closed trades. |
| Tier 2: HIGH VALUE | `\d overtrading_events` shows unique constraint. `docker compose logs api` → all JSON lines. `npm test` → all green. |
| Tier 3: POST-AUDIT | No `||` on data fields in tradeService.js INSERT or publisher.js XADD. `npm test` → all green. |

**Do NOT skip gate checks. A broken fix cascades into more broken things.**

### Step 4: Commit After Each Tier

```bash
# After Tier 1
git add -A
git commit -m "fix(audit-t1): queueLag type, publish retry, seed nullish coalescing

- queueLag: XPENDING returns integer, not XINFO stream ID string
- tradeService: 2-attempt retry on Redis publish failure with pino logging
- seed.js: || → ?? to preserve pnl=0 and revengeFlag=false"
git push origin main --force

# After Tier 2
git add -A
git commit -m "fix(audit-t2): overtrading dedup, structured API logs

- 005 migration: UNIQUE(user_id, window_end) on overtrading_events
- overtradingDetector: ON CONFLICT DO NOTHING replaces check-then-insert
- database.js, redis.js: console.error → pino structured logging"
git push origin main --force
```

---

## Error Recovery

### Fix broke existing tests
```bash
# Revert to last commit
git stash
npm test
# If tests pass → the fix introduced the regression
git stash pop
# Debug the fix
```

### Docker won't start after migration change
```bash
docker compose down -v
docker compose up --build
```

### Need to re-seed after seed.js fix
```bash
docker compose down -v          # nuke volumes (drops data)
docker compose up --build -d    # rebuilds + re-runs migrate → seed → server
```

---

## Time Tracking

| Tier | Bug | Planned | Actual | Duration | Commit |
|---|---|---|---|---|---|
| T1 | Fix 1: queueLag type | 10 min | — | — | — |
| T1 | Fix 2: Redis publish retry | 10 min | — | — | — |
| T1 | Fix 3: seed.js nullish | 2 min | — | — | — |
| T2 | Fix 4: overtrading dedup | 10 min | — | — | — |
| T2 | Fix 5: structured API logs | 5 min | — | — | — |
| T3 | Fix 6: exitPrice null coercion | 2 min | — | — | — |
| T3 | Fix 7: entryRationale empty string | 2 min | — | — | — |
| T3 | Fix 8: publisher nullish | 2 min | — | — | — |
| — | **Total** | **~43 min** | — | — | — |
