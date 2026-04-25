# How to Use This Workflow

> **Quick reference**: Keep this open during development sessions. It tells you exactly what to say and when.

---

## Starting a Session

| What you want to do | What to say |
|---|---|
| **Begin Phase 1** | `"Phase 1: Start"` |
| **Begin any phase** | `"Phase N: Start"` |
| **Resume after a break** | `"Continue from where we left off"` |
| **Check current progress** | `"Show me task.md status"` |

The AI will automatically:
1. Read `task.md` → find what's done and what's next
2. Read `rules.md` + `clauderules` → load constraints
3. Read `context.md` → load the spec for the current task
4. Start building from the next unchecked `[ ]` item

---

## During a Session

| Situation | What to say |
|---|---|
| **Everything's going well** | `"Continue"` or `"Looks good, keep going"` |
| **Something broke** | `"The health endpoint returns 500, fix it"` |
| **Want to skip ahead** | `"Skip to Phase 3"` (AI will warn if gates aren't passed) |
| **Want a specific file first** | `"Do the health endpoint first"` |
| **Need to understand something** | `"Explain how the Redis pipeline works"` |
| **Want to pause** | `"Stop"` or `"Wait, let me check something"` |
| **Want to test manually** | `"Run docker compose up and test the health endpoint"` |

---

## Ending a Session

| What you want to do | What to say |
|---|---|
| **Stop and save progress** | `"Commit and stop"` — AI commits + updates task.md |
| **Just stop** | `"Stop here for now"` — AI updates task.md |
| **Verify before stopping** | `"Run the gate check for this phase"` |

---

## Session Flow Diagram

```
┌─────────────────────────────────────────┐
│           YOU: "Phase 1: Start"         │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│  AI reads: task.md → rules → context    │
│  Finds first unchecked [ ] item         │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│         BUILD LOOP (per file)           │
│                                         │
│  1. Read placeholder file               │
│  2. Read spec from context.md           │
│  3. Write full implementation           │
│  4. Smoke test (curl / docker check)    │
│  5. Mark [x] in task.md                 │
│  6. → Next file                         │
│                                         │
│  YOU can say "continue" or "stop"       │
│  at any point in this loop              │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│          PHASE GATE CHECK               │
│                                         │
│  AI runs verification for the phase:    │
│  • Phase 1: containers healthy?         │
│  • Phase 2: auth curl tests pass?       │
│  • Phase 3: idempotency works?          │
│  • etc.                                 │
│                                         │
│  Must PASS before next phase starts     │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│  AI: "Phase N complete. Gate passed.    │
│       Ready for Phase N+1?"            │
│                                         │
│  YOU: "Phase N+1: Start"               │
└─────────────────────────────────────────┘
```

---

## Phase Gate Checks

These are the verification steps the AI runs at the end of each phase. You don't need to remember them — the AI does it automatically.

| Phase | Gate Check | Pass Criteria |
|---|---|---|
| 1. Foundation | `docker compose up` | All 4 containers healthy, 388 trades + 52 sessions in DB |
| 2. Auth | curl tests | No token → 401, expired → 401, valid → passes through |
| 3. Write API | curl tests | POST trade → 200, duplicate → 200 same body, wrong user → 403 |
| 4. Pipeline | log + DB check | POST closed trade → worker logs → metrics appear in DB |
| 5. Read API | curl all endpoints | All 7 endpoints return spec-compliant JSON |
| 6. Testing | `npm test` | All tests green |
| 7. Load Test | k6 report | p95 ≤ 150ms, error rate < 1% |
| 8. Deploy | live URL check | Health endpoint accessible on deployment URL |

---

## Multi-Day Strategy

If you're spreading this across multiple days:

### Day 1 (~8-10 hours)
```
"Phase 1: Start"    → Foundation (4h)
"Phase 2: Start"    → Auth (4h)
"Commit and stop"
```

### Day 2 (~12-14 hours)
```
"Continue from where we left off"
"Phase 3: Start"    → Write API (6h)
"Phase 4: Start"    → Async Pipeline (8h)
"Commit and stop"
```

### Day 3 (~12-14 hours)
```
"Continue from where we left off"
"Phase 5: Start"    → Read API (8h)
"Phase 6: Start"    → Testing (start)
"Commit and stop"
```

### Day 4 (~12-14 hours)
```
"Continue from where we left off"
→ Finish testing, load testing, polish, deploy
"Phase 8: Start"    → Deploy + verify
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| AI doesn't know what phase we're on | Say `"Read task.md and tell me the status"` |
| AI is working on the wrong file | Say `"Stop. Work on src/routes/trades.js instead"` |
| AI broke something that was working | Say `"Revert the last change to <filename>"` |
| Docker isn't starting | Say `"Debug: docker compose up is failing"` |
| Tests are failing | Say `"Run npm test and fix the failures"` |
| Need to start over on a file | Say `"Rewrite src/services/tradeService.js from scratch"` |

---

## File Map (What Lives Where)

```
.planning/
├── implementation_plan.md   ← Master blueprint (8 phases, architecture)
├── context.md               ← All spec details (API contracts, DB schema, seed data)
├── task.md                  ← Progress checklist (update as we go)
├── rules.md                 ← Compliance rules + anti-patterns
├── workflow.md              ← Phase execution protocol
└── USAGE.md                 ← THIS FILE — how to talk to the AI

.clauderules                 ← Auto-loaded AI constraints (you never need to read this)
```

---

## The Golden Rule

> **You don't need to manage the AI.** Just say what phase you want, and the system handles the rest. The `.clauderules` file, `task.md`, `context.md`, and `rules.md` work together to keep everything consistent, safe, and spec-compliant.
