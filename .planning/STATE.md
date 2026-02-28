# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-24)

**Core value:** Never lose track of which terminal needs attention — instant visibility into the status of every running Claude instance, with alerts that pull you back when action is needed.
**Current focus:** Phase 7 - Advanced Recommendations Engine

## Current Position

Phase: 7 of 7 (Advanced Recommendations Engine)
Plan: 2 of 3 in current phase
Status: In Progress
Last activity: 2026-02-28 — Plan 07-02 (Score History Persistence and IPC/HTTP Endpoints) complete

Progress: [██████████] 100%

### Roadmap Evolution

- Phase 6 added: Session Log Analysis — on-demand Claude CLI analysis of terminal logs for optimization recommendations
- Phase 7 added: Advanced Recommendations Engine — research-backed best practices, expanded JSONL parsing, anti-pattern detection, achievement badges, trend tracking

## Performance Metrics

**Velocity:**
- Total plans completed: 15
- Average duration: 4.1 minutes
- Total execution time: 1.16 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 3 | 32 min | 10.7 min |
| 02 | 1 | 3 min | 3.0 min |
| 03 | 2 | 6 min | 3.0 min |
| 04 | 2 | 7 min | 3.5 min |
| 05 | 5 | 10 min | 2.0 min |
| 06 | 2 | 14 min | 7.0 min |

**Recent Trend:**
- Last 5 plans: 05-04 (2min), 05-05 (2min), 06-01 (6min), 06-02 (8min)
- Trend: Slightly increasing (4.5 minute average, analysis plans are larger)

*Updated after each plan completion*

**Detailed Metrics:**

| Phase-Plan | Duration | Tasks | Files |
|------------|----------|-------|-------|
| Phase 01 P01 | 5 min | 3 tasks | 22 files |
| Phase 01 P02 | 2 min | 3 tasks | 5 files |
| Phase 01 P02 | 2 | 3 tasks | 5 files |
| Phase 01 P03 | 25 | 4 tasks | 8 files |
| Phase 02 P01 | 3 | 2 tasks | 5 files |
| Phase 03 P01 | 4 | 2 tasks | 5 files |
| Phase 03 P02 | 2 | 2 tasks | 9 files |
| Phase 04 P01 | 3 | 2 tasks | 5 files |
| Phase 04 P02 | 4 | 2 tasks | 11 files |
| Phase 05 P01 | 2 | 2 tasks | 7 files |
| Phase 05 P02 | 3 | 2 tasks | 9 files |
| Phase 05 P03 | 1 | 2 tasks | 2 files |
| Phase 05 P04 | 2 | 2 tasks | 3 files |
| Phase 05 P05 | 2 | 3 tasks | 3 files |
| Phase 06 P01 | 6 | 5 tasks | 7 files |
| Phase 06 P02 | 8 | 5 tasks | 13 files |
| Phase 07 P01 | 6 | 3 tasks | 3 files |
| Phase 07 P02 | 3 | 3 tasks | 4 files |

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
- [Phase 03]: Use execFile instead of exec for git commands to prevent shell injection
- [Phase 03]: 5-second timeout on git commands to prevent hangs on large repos
- [Phase 03]: Parse git status --porcelain instead of using isomorphic-git library
- [Phase 03]: Duplicate GitContext interface in main process (can't import from Angular src)
- [Phase 03]: 30-second polling interval for git context updates
- [Phase 03]: Remove cdkDropListOrientation="mixed" - not supported in CDK 17.3.10
- [Phase 03]: Dashboard uses CSS Grid auto-fill with minmax(400px) for responsive columns
- [Phase 03]: Maximize toggle uses *ngIf swap, terminal WebSocket reconnects on component recreation
- [Phase 04]: Use inline ANSI regex instead of strip-ansi npm package (ESM-only, incompatible with CommonJS)
- [Phase 04]: Sliding window approach (500 chars) prevents stale pattern matches from scrollback
- [Phase 04]: Use emoji (🔇/🔊) for mute toggle button instead of text labels for compact visual design
- [Phase 04]: Priority-based alert debouncing (2s cooldown) prevents audio spam during rapid status changes
- [Phase 05]: Bind both WebSocket and HTTP servers to 0.0.0.0 for LAN access
- [Phase 05]: Use Node.js http.createServer instead of express.js for zero-dependency static server
- [Phase 05]: Guard electronAPI calls with existence checks for remote browser compatibility
- [Phase 05]: Remote browsers get monitoring-only mode (WebSocket works, IPC degrades gracefully)
- [Phase 05]: Mobile viewports (<600px) use single-column layout with larger touch targets
- [Phase 05]: Dynamic WebSocket URL uses window.location.hostname for LAN compatibility
- [Phase 05]: Cross-reference pattern for /api/sessions using saved sessions filtered by active PTYs
- [Phase 05]: 5-second polling interval for remote browser session sync
- [Phase 05]: 30-second resync interval for remote browsers prevents xterm.js desync
- [Phase 05]: Clear-then-replay protocol ensures clean terminal state before buffer resync
- [Phase 05]: crypto.getRandomValues polyfill for UUID generation in insecure HTTP contexts
- [Phase 05]: HTTP API fallback routing in pty-manager service for remote browsers
- [Phase 05]: Server-side session saving in POST /api/sessions endpoint
- [Phase 06]: Streaming readline parser for JSONL — never load entire files into RAM, max 50 files / 20K lines
- [Phase 06]: 5-minute cache TTL prevents redundant re-parsing on repeated analysis requests
- [Phase 06]: Weighted practice scoring: Tool-Nativeness 25%, Subagent 20%, Read-before-Write 20%, Context-Efficiency 20%, Error-Rate 15%
- [Phase 06]: Recommendations in German to match project language conventions
- [Phase 06]: Pure CSS bars for tool usage visualization (no chart library dependency)
- [Phase 06]: 60-second score refresh interval in dashboard
- [Phase 06]: Raised component CSS budget to 8kb for analysis panel styling
- [Phase 07]: detectAntiPatterns() exported for direct unit testing
- [Phase 07]: correction-loop threshold: 4 edits (not 3) to reduce false positives
- [Phase 07]: readStatsCache() returns null instead of empty array, parses real v2 schema
- [Phase 07]: HistoryEntry kept local to score-history.ts to avoid Electron main process depending on Angular shared types
- [Phase 07]: 5-minute detail cache in analysis-handlers.ts prevents re-parsing for repeated session detail views
- [Phase 07]: Score history appended on every LOG_SESSION_SCORE (not just LOG_SESSION_DETAIL) to ensure trends accumulate

### Pending Todos

None yet.

### Blockers/Concerns

**Research Findings:**
- **Phase 4 concern:** Status detection prompt patterns (^assistant>, thinking markers) are based on observation of Claude CLI output but not formally documented by Anthropic. Patterns may change with Claude CLI updates. Mitigation: Combine with idle timeout heuristic, design StatusDetectorService for easy pattern updates, plan for testing with real usage.
- **Windows-specific:** All pitfalls (worker thread termination, resize crash, scrollback memory) have proven solutions from claude-terminal-overseer reference implementation. Address in Phase 1.

## Session Continuity

Last session: 2026-02-28 (plan execution)
Stopped at: Completed 07-02-PLAN.md (Score History Persistence and IPC/HTTP Endpoints) — Phase 7 Plan 2 of 3 done
Resume file: None
