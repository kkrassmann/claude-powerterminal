# System Review Report

Generated: 2026-03-27

## Summary

| Agent | Critical | Major | Minor | Total |
|---|---|---|---|---|
| Architecture | 2 | 7 | 7 | 16 |
| Quality | 1 | 8 | 9 | 18 |
| Testing | 0 | 4 | 8 | 12 |
| **Total** | **3** | **19** | **24** | **46** |
| Deduplicated | | -5 | | -5 |
| **Unique** | **3** | **14** | **24** | **41** |

---

## Deduplicated Findings

These findings were reported by multiple agents and merged into a single entry:

| Merged ID | Description | Identified by |
|---|---|---|
| A-001 | Preload script exposes all IPC channels without a validChannels whitelist | Architecture, Testing |
| A-004 | SessionMetadata interface defined in 4 separate files with field drift | Architecture, Quality |
| A-005 | loadSessionsFromDisk() implemented 3 times with subtle behavioral differences | Architecture, Quality |
| A-006 | PTY wiring (buffer + detector + onData/onExit) copy-pasted across 4 call sites | Architecture, Quality |
| A-008 | WebSocket onExit handler leaks — new handler registered per connection, never disposed on close | Architecture, Quality |

---

## Architecture Review

### Critical

**A-001 CRITICAL** — `electron/preload.ts:30-31`
Preload script exposes all IPC channels to the renderer without a whitelist. Any channel string can be invoked from renderer context, bypassing Electron's security boundary. *Also reported by Testing (T-010). Recommendation: add a `validChannels` filter using `IPC_CHANNELS` constants.*

**A-002 CRITICAL** — `electron/http/static-server.ts`
The HTTP API on port 9801 has no authentication. Any device on the LAN can spawn PTY sessions, read logs, and execute commands. *Recommendation: add token-based auth (e.g., shared secret in query param or Authorization header) before exposing to any network.*

### Major

**A-003 MAJOR** — `electron/http/static-server.ts` (1255 lines)
The HTTP server duplicates all business logic from IPC handlers instead of calling them directly. This creates three parallel maintenance surfaces for every feature. *See also: A-005, A-006. Recommendation: refactor handlers into shared service modules callable by both IPC and HTTP layers.*

**A-004 MAJOR** — `session.model.ts`, `main.ts`, `session-handlers.ts`, `static-server.ts`
`SessionMetadata` interface is defined in 4 files with gradual field drift between them. *Identified by: Architecture, Quality. Recommendation: define once in `src/shared/` and import everywhere.*

**A-005 MAJOR** — `main.ts`, `session-handlers.ts`, `static-server.ts`
`loadSessionsFromDisk()` is implemented 3 times with subtle differences in error handling and field mapping. *Identified by: Architecture, Quality. See also: Q-003. Recommendation: export a single canonical implementation from `session-handlers.ts`.*

**A-006 MAJOR** — PTY wiring across 4 call sites
Buffer attachment, StatusDetector wiring, and `onData`/`onExit` handler registration are copy-pasted in 4 places. Any bug fix or feature addition must be applied in all locations. *Identified by: Architecture, Quality. Recommendation: extract a shared `wirePtyHandlers()` utility function.*

**A-007 MAJOR** — `electron/ipc/pty-handlers.ts`
`execSync('wmic ...')` blocks the Electron main process for up to 3 seconds on every PTY spawn on Windows. *Recommendation: replace with an async child_process call or a native API alternative.*

**A-008 MAJOR** — `electron/websocket/`
A new `onExit` handler is registered for every WebSocket connection and never cleaned up when the connection closes, causing a handler accumulation leak. *Identified by: Architecture, Quality. Recommendation: track and dispose handlers in the WebSocket close callback.*

**A-009 MAJOR** — `main.ts` session restore
Sessions are restored sequentially with a hardcoded 3-second delay between each spawn to avoid `.claude.json` write races, making startup time O(n). *Recommendation: investigate the actual race condition and fix it at the source rather than using blanket delays; or at minimum parallelize with a concurrency limit.*

### Minor

**A-010 MINOR** — `src/shared/ipc-channels.ts`
`PTY_RESIZE` is declared as an IPC channel constant but no `ipcMain.handle()` registration exists for it. *Recommendation: implement the handler or remove the constant.*

**A-011 MINOR** — `package.json`
`@angular/cli` and `typescript` are listed in `dependencies` instead of `devDependencies`, inflating production install size. *Recommendation: move to `devDependencies`.*

**A-012 MINOR** — `package.json`
`node-addon-api` is listed in `dependencies` but is never imported anywhere in the codebase. *Recommendation: remove.*

**A-013 MINOR** — PTY output path
`appendFileSync` is called synchronously on every PTY output chunk, blocking the event loop on every keystroke and output line. *Recommendation: use async file I/O or a write-stream with buffering.*

**A-014 MINOR** — `electron/analysis/`
The analysis `sessionDetailCache` has no size bound and will grow indefinitely for long-running sessions. *Recommendation: add an LRU eviction policy or a max-entry limit.*

**A-015 MINOR** — `electron/` log service
The ring buffer uses `Array.shift()` which is O(n) per entry. For high-throughput PTY output this degrades performance over time. *Recommendation: replace with a circular buffer implementation.*

**A-016 MINOR** — `main.ts` `webPreferences`
`sandbox: false` weakens Electron's process isolation. Combined with A-001, this significantly expands the attack surface. *Recommendation: enable sandbox mode and audit preload API accordingly.*

---

## Code Quality Review

*(Findings merged into Architecture section: Q-001→A-004, Q-002→A-005, Q-006→A-008, Q-016→A-006)*

### Critical

**Q-007 CRITICAL** — `electron/http/static-server.ts`
The HTTP server is started on app ready but never stopped when the app quits. This can prevent the process from exiting cleanly and leaves the port bound. *Recommendation: call `server.close()` in the Electron `app.on('before-quit')` or `will-quit` handler.*

### Major

**Q-003 MAJOR** — `main.ts`, `session-handlers.ts`
`getSessionsFilePath()` is duplicated in 2 files. Divergence here would silently break session persistence. *See also: A-005. Recommendation: export from one location and import in the other.*

**Q-004 MAJOR** — `electron/status/`, `src/shared/`
`TerminalStatus` type is defined in 2 separate locations. The renderer and main process may diverge on valid status values. *See also: A-004 pattern. Recommendation: define once in `src/shared/` and import in both.*

**Q-005 MAJOR** — `electron/ipc/git-handlers.ts`, `src/src/app/services/git-context.service.ts`
`GitContext` interface is defined in 2 files. *Recommendation: consolidate in `src/shared/` alongside other shared types.*

**Q-008 MAJOR** — `src/src/app/app.component.ts`
Two `setInterval` calls are created without corresponding `clearInterval` calls on component destroy, causing memory leaks and continued execution after navigation. *Recommendation: store interval IDs and clear them in `ngOnDestroy`.*

**Q-009 MAJOR** — `src/src/app/services/group.service.ts`
`GroupService` creates a `setInterval` without cleanup. *Recommendation: implement `ngOnDestroy` and clear the interval.*

### Minor

**Q-010 MINOR** — `electron/websocket/`
Client metadata on WebSocket instances is typed as `any` throughout. *Recommendation: define a typed interface for the extended WebSocket client object.*

**Q-011 MINOR** — Codebase-wide
98 `any` usages across 21 Electron files; 24 across 10 Angular files. These suppress type errors and hide real bugs. *Recommendation: address incrementally, prioritizing IPC message boundaries and PTY data handlers.*

**Q-012 MINOR** — `electron/analysis/score-history.ts`
`readScoreHistory` is exported but never imported externally — dead export. *Recommendation: remove the export qualifier or verify intended consumers.*

**Q-013 MINOR** — `electron/` utilities
`setUserDataPath` is exported but never imported outside its own module. *Recommendation: remove export or document intended use.*

**Q-014 MINOR** — `electron/analysis/`
`clearCache` and `readStatsCache` are only used internally and in tests. *Recommendation: keep for testability but remove public exports if not part of a documented API.*

**Q-015 MINOR** — `src/src/app/components/dashboard/`
`layoutSubscription` is declared in `DashboardComponent` but never assigned, making it dead code that suggests incomplete subscription management. *Recommendation: either assign and unsubscribe properly, or remove the declaration.*

**Q-017 MINOR** — Codebase-wide
Magic numbers for timeouts (3000ms, 5000ms, etc.) are scattered across multiple files with no named constants explaining their purpose. *Recommendation: define named constants in a shared config file.*

**Q-018 MINOR** — Multiple Electron files
`JSON.parse` results are used without validation in several places. Malformed data from disk or network can cause silent runtime failures. *Recommendation: add schema validation (e.g., zod) or at minimum try/catch with type guards at IPC and HTTP boundaries.*

---

## Test Coverage Review

### Major

**T-001 MAJOR** — `electron/main.ts` (491 lines)
The application entry point has zero test coverage. Session restore, startup sequencing, and IPC registration are all untested. *Recommendation: extract testable units (session loader, IPC registry) and cover startup paths.*

**T-002 MAJOR** — `electron/ipc/worktree-handlers.ts` (244 lines)
Worktree handlers have zero test coverage despite complex filesystem operations. *Recommendation: add unit tests with mocked `fs` and `git` calls.*

**T-003 MAJOR** — IPC/HTTP parity
There are no integration tests verifying that HTTP endpoints and IPC channels expose identical behavior. Drift here silently breaks remote browser access. *Recommendation: add a parity test suite that calls both transports with identical inputs and compares outputs.*

**T-004 MAJOR** — Session lifecycle
No test covers the full save → restore → resume flow. This is the most user-visible failure mode on app restart. *Recommendation: add an integration test using a temp userData directory.*

### Minor

**T-005 MINOR** — `electron/ipc/review-handlers.ts` (173 lines) — zero coverage.

**T-006 MINOR** — `electron/ipc/analysis-handlers.ts` (134 lines) — zero coverage.

**T-007 MINOR** — `electron/ipc/template-handlers.ts` (121 lines) — zero coverage.

**T-008 MINOR** — `electron/analysis/score-history.ts` (85 lines) — zero coverage.

**T-009 MINOR** — `electron/utils/process-cleanup.ts` (75 lines) — zero coverage.

**T-010 MINOR** — `electron/preload.ts`
Preload exposes all IPC channels without validation. *See also: A-001. Covered in the Architecture critical finding.*

**T-011 MINOR** — PTY data flow
No test covers PTY output flowing through the WebSocket bridge to the client renderer. End-to-end data integrity is entirely unverified. *Recommendation: add an integration test with a mock PTY and a WebSocket test client.*

**T-012 MINOR** — `electron/ipc/git-handlers.ts` (130 lines) — zero coverage.

---

## Test Infrastructure

The project uses **Vitest** for backend (Electron) tests, with test files co-located next to source (`*.test.ts`). Currently only 3 of 18 backend modules have any test coverage: `log-analyzer.ts`, `status-detector.ts` (partially), and `score-cache.ts`. The Angular frontend uses Karma/Jasmine but is not actively maintained.

There is no CI step that enforces a coverage threshold, and no integration test suite for the dual-transport layer. The `npm test` command runs all Vitest tests; individual files can be targeted with `npx vitest run <path>`. Adding a coverage report step (`vitest --coverage`) to CI would surface the 15-module gap automatically.
