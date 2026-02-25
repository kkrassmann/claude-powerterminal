# Phase 4 Plan 1: Status Detection Backend Summary

**One-liner:** StatusDetector backend engine with pattern matching state machine, ANSI stripping, 5-second idle timeout, and WebSocket status broadcasts

---

## Frontmatter

```yaml
phase: 04-status-detection-alerts
plan: 01
subsystem: status-detection-backend
tags: [backend, status-detection, pattern-matching, websocket]
completed: 2026-02-25

dependency_graph:
  requires: [02-01]  # WebSocket bridge
  provides: [status-detection-engine, ansi-stripping, status-websocket-protocol]
  affects: [pty-handlers, ws-server, ws-protocol]

tech_stack:
  added:
    - StatusDetector class (state machine)
    - ANSI stripping utility (inline regex)
  patterns:
    - Sliding window for pattern matching (500 chars)
    - Callback-based status change notifications
    - Priority-based pattern matching (ERROR > WAITING > WORKING)

key_files:
  created:
    - electron/status/status-detector.ts
    - electron/status/ansi-strip.ts
  modified:
    - src/shared/ws-protocol.ts
    - electron/ipc/pty-handlers.ts
    - electron/websocket/ws-server.ts

decisions:
  - Use inline ANSI regex instead of strip-ansi npm package (ESM-only, incompatible with CommonJS)
  - Sliding window approach (500 chars) prevents stale pattern matches from scrollback
  - Clear recentOutput buffer on WORKING transition from WAITING/ERROR to prevent stale matches
  - StatusDetector uses callback pattern (not EventEmitter) for simplicity and zero overhead

metrics:
  duration: 3 minutes
  tasks: 2
  files_created: 2
  files_modified: 3
  commits: 2
  lines_added: ~400
```

---

## What Was Built

Implemented the core status detection engine for Phase 4 — a backend system that analyzes PTY output in real-time to detect Claude CLI terminal states (WORKING, THINKING, WAITING, ERROR, DONE). The engine runs in the Electron main process, close to the PTY output stream, and broadcasts status changes to the Angular frontend via the existing WebSocket protocol.

**Core Components:**

1. **StatusDetector class** (`electron/status/status-detector.ts`):
   - State machine with 5 states: WORKING, THINKING, WAITING, ERROR, DONE
   - Pattern matching with priority order: ERROR > WAITING > WORKING
   - 5-second idle timeout for WORKING → THINKING transition
   - Sliding window (500 chars) to prevent stale pattern matches from scrollback
   - Callback-based status change notifications (not EventEmitter — simpler, zero overhead)

2. **ANSI stripping utility** (`electron/status/ansi-strip.ts`):
   - Inline regex from ansi-regex project (MIT licensed)
   - No external dependencies (strip-ansi npm package is ESM-only, incompatible with CommonJS)
   - Removes ANSI escape codes before pattern matching

3. **WebSocket protocol extension** (`src/shared/ws-protocol.ts`):
   - Added `TerminalStatus` type: `'WORKING' | 'THINKING' | 'WAITING' | 'ERROR' | 'DONE'`
   - Extended `ServerMessage` union with `{ type: 'status'; status: TerminalStatus }`

4. **PTY handler integration** (`electron/ipc/pty-handlers.ts`):
   - Create StatusDetector on PTY spawn
   - Feed PTY output to detector via `processOutput` in `onData` handler
   - Call `processExit` on PTY exit to trigger DONE status
   - Destroy detector on PTY kill/exit
   - Handle detector lifecycle in PTY_RESTART (destroy old, create new)

5. **WebSocket server integration** (`electron/websocket/ws-server.ts`):
   - `broadcastStatus` function sends status updates to all clients connected to a session
   - Send initial status to new WebSocket clients after scrollback replay
   - Export `getStatusDetectors` for PTY handlers to access detector map

**Pattern Matching Strategy:**

- **WAITING patterns:** `❯` at end of output, `? ... (Y/n)` questions, `Do you want to proceed` prompts
- **WORKING patterns:** `● ` tool call indicator, any new output
- **ERROR patterns:** `Error:`, `Interrupted`, `ENOENT`, `EACCES`
- **DONE:** PTY process exit event only (not Claude exit messages)

**Key Design Decisions:**

- Sliding window approach (500 chars) prevents matching stale prompts from scrollback history
- Clear `recentOutput` buffer on WORKING transition from WAITING/ERROR to prevent stale matches after user provides input
- Pattern matching runs in main process (close to PTY) — single source of truth, no duplicate parsing in frontend
- StatusDetector uses callback pattern (not EventEmitter) for simplicity and zero overhead

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create StatusDetector and ANSI strip utility | 32a1e5f | electron/status/status-detector.ts, electron/status/ansi-strip.ts, src/shared/ws-protocol.ts |
| 2 | Wire StatusDetector into PTY handlers and WebSocket server | 30fb980 | electron/ipc/pty-handlers.ts, electron/websocket/ws-server.ts |

---

## Deviations from Plan

None — plan executed exactly as written.

---

## Testing & Verification

**Automated verification:**
- TypeScript compilation passes: `npx tsc --noEmit --project tsconfig.json` ✓

**Manual verification needed (frontend not yet built):**
- StatusDetector correctly transitions between WORKING, THINKING, WAITING, ERROR, DONE states
- ANSI escape codes are stripped before pattern matching
- Sliding window prevents stale pattern matches
- 5-second idle timeout transitions WORKING to THINKING
- Status changes are broadcast via WebSocket to connected clients
- New WebSocket clients receive current status on connect

**Integration testing plan (for Phase 4 Plan 2 - Frontend UI):**
1. Start Claude CLI session, verify initial status is WORKING
2. Let session idle for 5+ seconds, verify transition to THINKING
3. Wait for Claude prompt (`❯`), verify transition to WAITING
4. Type invalid command to trigger error, verify transition to ERROR
5. Exit PTY process, verify transition to DONE
6. Restart session, verify new StatusDetector is created and old one is destroyed

---

## Self-Check

**Verify created files exist:**
```bash
$ [ -f "electron/status/status-detector.ts" ] && echo "FOUND: electron/status/status-detector.ts" || echo "MISSING: electron/status/status-detector.ts"
FOUND: electron/status/status-detector.ts

$ [ -f "electron/status/ansi-strip.ts" ] && echo "FOUND: electron/status/ansi-strip.ts" || echo "MISSING: electron/status/ansi-strip.ts"
FOUND: electron/status/ansi-strip.ts
```

**Verify commits exist:**
```bash
$ git log --oneline --all | grep -q "32a1e5f" && echo "FOUND: 32a1e5f" || echo "MISSING: 32a1e5f"
FOUND: 32a1e5f

$ git log --oneline --all | grep -q "30fb980" && echo "FOUND: 30fb980" || echo "MISSING: 30fb980"
FOUND: 30fb980
```

**Self-Check: PASSED** ✓

---

## Next Steps

**Immediate next plan (04-02):** Build the frontend UI components to display status indicators:
- Status dot in tile header for all states
- Box-shadow glow for high-priority states (WAITING static glow, ERROR pulsing glow)
- Wire up WebSocket status messages in TerminalComponent
- Track per-session status in DashboardComponent
- Apply status CSS classes to tile elements

**Blockers for next plan:** None

**Tech debt:** None

**Documentation needed:** None (frontend implementation will validate patterns in real usage)

---

*Plan completed: 2026-02-25*
*Duration: 3 minutes*
*Commits: 32a1e5f, 30fb980*
