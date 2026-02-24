# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-24)

**Core value:** Never lose track of which terminal needs attention — instant visibility into the status of every running Claude instance, with alerts that pull you back when action is needed.
**Current focus:** Phase 2 - WebSocket Bridge & UI

## Current Position

Phase: 2 of 5 (WebSocket Bridge & UI)
Plan: 2 of 2 in current phase
Status: In progress
Last activity: 2026-02-24 — Completed 02-01-PLAN.md (WebSocket Bridge Infrastructure)

Progress: [████░░░░░░] 27%

## Performance Metrics

**Velocity:**
- Total plans completed: 4
- Average duration: 8.8 minutes
- Total execution time: 0.58 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 3 | 32 min | 10.7 min |
| 02 | 1 | 3 min | 3.0 min |

**Recent Trend:**
- Last 5 plans: 01-01 (5min), 01-02 (2min), 01-03 (25min), 02-01 (3min)
- Trend: Improving (infrastructure plans faster than UI plans)

*Updated after each plan completion*

**Detailed Metrics:**

| Phase-Plan | Duration | Tasks | Files |
|------------|----------|-------|-------|
| Phase 01 P01 | 5 min | 3 tasks | 22 files |
| Phase 01 P02 | 2 min | 3 tasks | 5 files |
| Phase 01 P02 | 2 | 3 tasks | 5 files |
| Phase 01 P03 | 25 | 4 tasks | 8 files |
| Phase 02 P01 | 3 | 2 tasks | 5 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Fresh project, not fork of overseer — Different goals, clean architecture, avoids inheriting constraints
- Node.js + Angular — User preference, proven combo from overseer experience
- Combined status detection (parsing + idle) — Pure parsing is fragile, pure idle is imprecise, both together are robust
- Local network first, auth later — Reduces v1 complexity, ngrok + login deferred to later phase
- Code review deferred — Significant scope, not needed for core "terminal oversight" value
- [Phase 01]: Session storage in userData directory for cross-platform compatibility and durability
- [Phase 01]: IPC architecture with renderer using IPC and main process handling file I/O for security
- [Phase 01]: Synchronous file writes (fs.writeFileSync) for session persistence to ensure durability
- [Phase 01]: Force-kill timeout of 3000ms for Windows PTY termination balancing responsiveness with graceful shutdown
- [Phase 01]: Environment sanitization (delete CLAUDECODE vars) to enable nested Claude CLI sessions
- [Phase 01]: Use browser crypto.randomUUID() instead of Node.js crypto for session ID generation in renderer context
- [Phase 01]: Spawn Claude CLI via cmd.exe /c for Windows PATH resolution instead of direct spawn
- [Phase 01]: Add isDestroyed() guards on IPC sends to prevent errors during window cleanup
- [Phase 01]: Implement isCleaningUp flag to prevent recursive will-quit handler execution
- [Phase 02]: WebSocket server on port 9800 for PTY bridge with 30-second heartbeat
- [Phase 02]: 10,000 line scrollback buffer with buffering/buffered signals for client reset
- [Phase 02]: Resize guard (try/catch) to prevent Windows crash on exited PTY

### Pending Todos

None yet.

### Blockers/Concerns

**Research Findings:**
- **Phase 4 concern:** Status detection prompt patterns (^assistant>, thinking markers) are based on observation of Claude CLI output but not formally documented by Anthropic. Patterns may change with Claude CLI updates. Mitigation: Combine with idle timeout heuristic, design StatusDetectorService for easy pattern updates, plan for testing with real usage.
- **Windows-specific:** All pitfalls (worker thread termination, resize crash, scrollback memory) have proven solutions from claude-terminal-overseer reference implementation. Address in Phase 1.

## Session Continuity

Last session: 2026-02-24 (plan execution)
Stopped at: Completed 02-01-PLAN.md (WebSocket Bridge Infrastructure)
Resume file: None
