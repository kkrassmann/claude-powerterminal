# System Review Report

Generated: 2026-03-01 21:15

## Summary

| Agent        | Critical | Major | Minor | Total |
|--------------|----------|-------|-------|-------|
| Architecture | 2        | 6     | 6     | 14    |
| Quality      | 2        | 9     | 9     | 20    |
| Testing      | 3        | 6     | 6     | 15    |
| **Total**    | **7**    | **21**| **21**| **49**|

---

## Architecture Review

### Architecture Findings

#### [CRITICAL] A-001: Preload script does not whitelist IPC channels
**File:** electron/preload.ts:26-28
**Description:** The preload script exposes `ipcRenderer.invoke(channel, ...args)` and `ipcRenderer.on(channel, callback)` without any channel whitelist. The `channel` parameter is an unvalidated string passed directly to Electron's IPC layer. Any code executing in the renderer (including injected scripts from XSS or compromised dependencies) can invoke arbitrary IPC channels or register listeners on any channel. The CLAUDE.md architecture notes mention a "validChannels whitelist" as an expected pattern, but it does not exist in the code.
**Impact:** An attacker who achieves code execution in the renderer can call any registered ipcMain.handle channel, including PTY_SPAWN (spawn arbitrary processes), PTY_WRITE (send commands to running CLI sessions), PTY_KILL, or SESSION_DELETE. Combined with sandbox: false (line 50 of main.ts), this significantly expands the attack surface.
**Recommendation:** Add a validChannels whitelist derived from IPC_CHANNELS values and reject unknown channels.

#### [CRITICAL] A-002: HTTP API endpoints have no authentication — full PTY spawn from LAN
**File:** electron/http/static-server.ts:129-241
**Description:** The POST /api/sessions endpoint spawns arbitrary PTY processes with caller-specified sessionId, cwd, and flags. It listens on 0.0.0.0:9801 (all interfaces) with CORS set to `Access-Control-Allow-Origin: *`. There is no authentication, no API key, no token, no origin check. Any device on the same LAN can spawn Claude CLI sessions in arbitrary directories on the host machine.
**Impact:** An attacker on the local network can spawn Claude sessions in any directory, effectively gaining command execution on the host. Even without direct shell access, Claude CLI with `--dangerously-skip-permissions` (passable via `flags`) runs with full filesystem and tool access.
**Recommendation:** At minimum, implement a shared secret / bearer token generated at startup and displayed in the Electron window. Remote browsers must present this token. Also restrict CORS to the actual LAN origin instead of wildcard `*`. Consider an opt-in mechanism for LAN access rather than enabling it by default.

#### [MAJOR] A-003: Massive business logic duplication between IPC handlers and HTTP server
**File:** electron/http/static-server.ts:129-241 vs electron/ipc/pty-handlers.ts:84-207
**Description:** The HTTP POST /api/sessions endpoint duplicates the entire PTY spawn logic from the IPC PTY_SPAWN handler: cwd validation, duplicate-cwd check, environment sanitization, pty.spawn call, scrollback buffer creation, status detector wiring, onData/onExit handler registration, and session persistence. This is approximately 110 lines of duplicated business logic. Similarly, loadSessionsFromDisk is duplicated three times: in main.ts:126, session-handlers.ts:35, and static-server.ts:42. The SessionMetadata interface is defined identically three times.
**Impact:** Any bug fix or behavioral change must be applied in multiple places. Divergence between IPC and HTTP code paths is likely (e.g., the HTTP handler spawns `claude.exe` directly, while the IPC handler checks for external claude.exe processes via wmic — the HTTP path skips this check).
**Recommendation:** Extract a shared `spawnAndRegisterPty(options)` function that both the IPC handler and HTTP handler call. Move SessionMetadata to `src/shared/` and import it everywhere.

#### [MAJOR] A-004: WebSocket onExit handler leaks — new handler registered per connection
**File:** electron/websocket/ws-server.ts:174-177
**Description:** Each new WebSocket connection registers a new `ptyProcess.onExit()` handler (line 174), but this handler is never disposed when the WebSocket closes. The `ws.on('close')` handler at line 223 only disposes `dataDisposable` (the onData handler). node-pty's `onExit` returns a disposable, but it is not captured or cleaned up. If a client reconnects multiple times to the same session, each connection adds another onExit listener to the same PTY process.
**Impact:** Memory leak proportional to number of reconnections per session.
**Recommendation:** Capture the onExit disposable and dispose it in the `ws.on('close')` handler.

#### [MAJOR] A-005: PTY_RESIZE IPC channel defined but never registered as handler
**File:** src/shared/ipc-channels.ts:12, electron/ipc/pty-handlers.ts (absent)
**Description:** The channel constant `PTY_RESIZE: 'pty:resize'` is defined in ipc-channels.ts but no `ipcMain.handle(IPC_CHANNELS.PTY_RESIZE, ...)` exists anywhere in the codebase. Resize only works through the WebSocket transport (ws-server.ts:205-211).
**Impact:** In Electron IPC mode, terminal resize is unsupported. Works in practice because Electron also uses WebSocket for PTY I/O, but the IPC API surface is incomplete.
**Recommendation:** Either register a PTY_RESIZE IPC handler or remove the constant from ipc-channels.ts.

#### [MAJOR] A-006: ScrollbackBuffer imported from Angular renderer into Electron main process
**File:** electron/ipc/pty-handlers.ts:16, electron/websocket/ws-server.ts:10, electron/http/static-server.ts:17, electron/main.ts:10
**Description:** Four Electron main-process files import `ScrollbackBuffer` from `../../src/src/app/services/scrollback-buffer.service`. This crosses the architectural boundary between the Electron backend and the Angular frontend.
**Impact:** Changes to Angular build config could break Electron compilation. Deep import path is fragile.
**Recommendation:** Move ScrollbackBuffer to `src/shared/` or `electron/utils/`.

#### [MAJOR] A-007: execSync in PTY_SPAWN request path blocks the main process
**File:** electron/ipc/pty-handlers.ts:110
**Description:** The PTY_SPAWN handler calls `execSync('wmic process where ...')` with a 3-second timeout to detect external Claude processes. `execSync` blocks the Node.js event loop, preventing all IPC handling, WebSocket I/O, and UI rendering for up to 3 seconds.
**Impact:** During the blocking call, the entire application freezes.
**Recommendation:** Replace `execSync` with async `execFile` using `promisify`.

#### [MAJOR] A-008: Session restore is O(n) sequential with 3-second delays
**File:** electron/main.ts:308-322
**Description:** `restoreAllSessions()` spawns sessions sequentially with a 3-second `setTimeout` delay between each session. For 20 sessions, this means ~57 seconds of startup time.
**Impact:** App startup becomes unusably slow with many sessions.
**Recommendation:** Parallelize with a concurrency limit (e.g., 3 at a time) instead of fully sequential spawning.

#### [MINOR] A-009: sessionDetailCache grows without bounds
**File:** electron/ipc/analysis-handlers.ts:17
**Description:** The `sessionDetailCache` Map has a 5-minute TTL per entry but never evicts expired entries.
**Recommendation:** Add periodic sweep or use LRU cache with max-size bound.

#### [MINOR] A-010: Global cachedResult has no invalidation on session changes
**File:** electron/analysis/log-analyzer.ts:35-36
**Description:** The `cachedResult` variable caches full analysis with 5-minute TTL but is not invalidated when sessions are created, destroyed, or generate new log data.
**Recommendation:** Invalidate cache on session lifecycle events.

#### [MINOR] A-011: process.on('uncaughtException') swallows errors without recovery
**File:** electron/main.ts:29-31
**Description:** Logs error but takes no recovery action. In packaged mode, console output may not be visible.
**Recommendation:** Log to file in userData for post-mortem debugging.

#### [MINOR] A-012: @angular/cli and typescript in root dependencies instead of devDependencies
**File:** package.json:30,33
**Description:** Build-time tools listed in `dependencies`, bloating the distributable.
**Recommendation:** Move to `devDependencies`.

#### [MINOR] A-013: restartingSessions Set never cleaned up on error paths
**File:** electron/ipc/pty-handlers.ts:284, 296, 360
**Description:** If `pty.spawn` fails during restart, the sessionId remains in `restartingSessions` forever, suppressing cleanup.
**Recommendation:** Wrap spawn block in try/catch that removes from `restartingSessions` on error.

#### [MINOR] A-014: Duplicate PTY event wiring code repeated four times
**File:** electron/ipc/pty-handlers.ts:159-200, :323-358, electron/main.ts:235-268, electron/http/static-server.ts:191-215
**Description:** The onData/onExit wiring pattern is copy-pasted 4 times with slight variations.
**Recommendation:** Extract `wirePtyHandlers(sessionId, ptyProcess, notifyRenderer)` function.

---

## Code Quality Review

### Quality Findings

#### [CRITICAL] Q-005: WebSocket onExit handler accumulates per connection (memory leak)
**File:** electron/websocket/ws-server.ts:174
**Description:** Every new WebSocket connection registers a new `ptyProcess.onExit()` handler that is never disposed when the WebSocket closes. The `ws.on('close')` handler only disposes `dataDisposable` (onData), not the onExit handler. Reconnections accumulate handlers.
**Impact:** Memory leak growing with each reconnection. Multiple stale callbacks fire on PTY exit.
**Recommendation:** Store and dispose the onExit disposable in `ws.on('close')`.

#### [CRITICAL] Q-012: HTTP static server never stopped on app quit
**File:** electron/main.ts:351, :396-428
**Description:** The `will-quit` handler stops WebSocket server and kills PTY processes, but the HTTP server started at line 351 is never stopped. The return value of `startStaticServer(9801)` is discarded.
**Impact:** Port 9801 may remain bound on restart. Active HTTP connections not cleanly terminated.
**Recommendation:** Store server reference and call server.close() in will-quit handler.

#### [MAJOR] Q-001: SessionMetadata interface duplicated 4 times with readonly drift
**Files:** electron/ipc/session-handlers.ts:16, electron/main.ts:107, electron/http/static-server.ts:31, src/src/app/models/session.model.ts:11
**Description:** Defined 4 times. Angular model uses `readonly`, Electron copies do not.
**Recommendation:** Define once in `src/shared/session-types.ts`.

#### [MAJOR] Q-002: GitContext interface duplicated with incorrect justification
**Files:** electron/ipc/git-handlers.ts:20, src/src/app/models/git-context.model.ts:11
**Description:** Comment states "Main process can't import from Angular src" — incorrect, src/shared/ already bridges both sides.
**Recommendation:** Move to `src/shared/git-types.ts`.

#### [MAJOR] Q-003: loadSessionsFromDisk / getSessionsFilePath / saveSessionsToDisk triplicated
**Files:** electron/ipc/session-handlers.ts:26-71, electron/main.ts:117-139, electron/http/static-server.ts:42-71
**Description:** Session persistence functions implemented 3 times with subtle divergences.
**Recommendation:** Export from session-handlers.ts, import elsewhere.

#### [MAJOR] Q-004: PTY registration pattern copy-pasted 4 times
**Files:** electron/ipc/pty-handlers.ts:144-200, :310-358, electron/main.ts:224-268, electron/http/static-server.ts:178-215
**Description:** Buffer + detector creation + event wiring duplicated with varying notification channels.
**Recommendation:** Extract `registerPtySession(sessionId, ptyProcess, notifySender)`.

#### [MAJOR] Q-006: TerminalStatus type defined twice
**Files:** src/shared/ws-protocol.ts:9, electron/status/status-detector.ts:19
**Recommendation:** Remove from status-detector.ts, import from shared.

#### [MAJOR] Q-007: StatusChangeCallback exported but never imported
**File:** electron/status/status-detector.ts:21
**Recommendation:** Remove export or use at callsites.

#### [MAJOR] Q-008: window.electronAPI declare global duplicated in 2 services
**Files:** src/src/app/services/session-manager.service.ts:9-17, src/src/app/services/pty-manager.service.ts:9-17
**Recommendation:** Define once in a shared `.d.ts` file.

#### [MAJOR] Q-009: Pervasive `catch (error: any)` pattern — 18 occurrences
**Description:** Every catch block uses `: any` instead of `: unknown` with guard.
**Recommendation:** Use `catch (error: unknown)` with `instanceof Error` guard.

#### [MAJOR] Q-013: AppComponent leaks intervals and IPC listeners (no OnDestroy)
**File:** src/src/app/app.component.ts:21-174
**Description:** Registers intervals and IPC listeners without cleanup.
**Recommendation:** Implement OnDestroy, store and clear references.

#### [MAJOR] Q-015: Port 9801 hardcoded in 7 files (9 occurrences)
**Description:** HTTP port has no shared constant unlike WS_PORT.
**Recommendation:** Add `HTTP_PORT = 9801` to shared config.

#### [MINOR] Q-010: `any` used for timer handles in Angular components
**Recommendation:** Use `ReturnType<typeof setTimeout>`.

#### [MINOR] Q-011: `ws as any` used 5 times for custom WebSocket properties
**Recommendation:** Define `ExtendedWebSocket` interface.

#### [MINOR] Q-014: JSON.parse results used without runtime validation — 9 occurrences
**Recommendation:** Add minimal runtime guards at trust boundaries.

#### [MINOR] Q-016: ScrollbackBuffer size 10000 hardcoded in 5 locations
**Recommendation:** Define shared constant `SCROLLBACK_LINES`.

#### [MINOR] Q-017: Multiple exported functions in log-analyzer.ts only used in tests
**Recommendation:** Mark with @internal or restructure tests.

#### [MINOR] Q-018: Dev server URL 'http://localhost:4800' hardcoded
**Recommendation:** Read from environment variable or constant.

#### [MINOR] Q-019: Unused parseJsonlFile export
**Recommendation:** Same as Q-017.

#### [MINOR] Q-020: setUserDataPath and readScoreHistory exported but never imported
**Recommendation:** Remove dead exports.

---

## Test Coverage Review

### Testing Findings

#### [CRITICAL] T-001: StatusDetector state machine has zero test coverage
**File:** electron/status/status-detector.ts (215 lines)
**Description:** The StatusDetector is a heuristic state machine that classifies PTY output into WORKING/THINKING/WAITING/ERROR/DONE states. It uses idle timers, content hashing, pattern matching against TUI chrome, ANSI window title extraction, and time-based thresholds. This is the core feature that powers the dashboard status indicators. Zero lines are tested.
**Impact:** Any regression in prompt detection, error detection, or idle timer thresholds would silently break status monitoring for every session.
**Recommendation:** Create `status-detector.test.ts` covering: state transitions, idle detection, TUI chrome stripping, OSC title extraction, error pattern matching, callback invocation, destroy cleanup.

#### [CRITICAL] T-002: PTY lifecycle handlers have zero test coverage
**File:** electron/ipc/pty-handlers.ts (366 lines)
**Description:** Manages PTY spawn, kill, write, list, and restart. Contains cwd validation, duplicate detection, external process check, environment sanitization, and restart state machine. Zero tests.
**Impact:** Handler bugs only caught at runtime. Restart race condition untested.
**Recommendation:** Extract pure logic into testable functions. Mock ipcMain and pty.

#### [CRITICAL] T-003: Session persistence has zero test coverage
**File:** electron/ipc/session-handlers.ts (165 lines)
**Description:** Manages sessions.json for persistence. Synchronous file I/O with JSON parse/stringify. All functions untested.
**Impact:** Corrupt sessions.json would lose all sessions on restart.
**Recommendation:** Test with temp file: missing file, invalid JSON, round-trip save/load.

#### [MAJOR] T-004: WebSocket server has zero test coverage
**File:** electron/websocket/ws-server.ts (272 lines)
**Description:** Real-time communication bridge. Connection auth, scrollback replay, heartbeat, PTY I/O forwarding. No tests.
**Recommendation:** Test with mock WebSocket and mock PTY.

#### [MAJOR] T-005: HTTP static server tests verify data shapes only, not actual server behavior
**File:** electron/http/static-server.test.ts (167 lines)
**Description:** Tests create plain objects and assert properties exist — tautological. Never imports the actual server, never sends HTTP requests, never exercises routing. 11 test cases that verify nothing about production code.
**Impact:** False confidence in coverage. 416 lines of routing logic completely untested.
**Recommendation:** Replace with real integration tests using supertest or extract handlers as pure functions.

#### [MAJOR] T-006: ANSI stripping and window title extraction are untested
**File:** electron/status/ansi-strip.ts (38 lines)
**Description:** Pure functions foundational to StatusDetector. If stripAnsi fails, all status detection breaks.
**Recommendation:** Test with real terminal escape sequences.

#### [MAJOR] T-007: Process cleanup utility is untested
**File:** electron/utils/process-cleanup.ts (75 lines)
**Description:** Graceful-then-force PTY kill with platform-specific behavior. Called on every kill, restart, and shutdown.
**Recommendation:** Test with mock IPty: graceful path, force path, already-terminated.

#### [MAJOR] T-008: Score history persistence is untested
**File:** electron/analysis/score-history.ts (85 lines)
**Description:** Score-history.json with bounded size (50 entries), deduplication, silent failure. Has `setUserDataPath()` for test setup but no tests use it.
**Recommendation:** Test with temp directory via setUserDataPath.

#### [MAJOR] T-009: Environment sanitization is untested
**File:** electron/utils/env-sanitize.ts (33 lines)
**Description:** Pure function removing Electron-injected env vars. Trivially testable.
**Recommendation:** Test: removes ELECTRON_*, preserves PATH/HOME, returns new object.

#### [MINOR] T-010: Log analyzer cache behavior test is trivial
**File:** electron/analysis/log-analyzer.test.ts:892
**Description:** Tests `expect(true).toBe(true)` after clearCache(). Does not verify cache is actually cleared.
**Recommendation:** Test actual cache invalidation behavior.

#### [MINOR] T-011: Static server test uses tautological assertions
**File:** electron/http/static-server.test.ts
**Description:** Creates objects then asserts their properties exist. Tests JavaScript syntax, not production code.
**Recommendation:** Delete and replace with real tests.

#### [MINOR] T-012: No test utilities or shared mocking infrastructure
**Description:** Each test file creates its own helpers. No shared mock for IPty, ipcMain, or BrowserWindow.
**Recommendation:** Create `electron/test-utils/` with reusable mocks.

#### [MINOR] T-013: No coverage reporting or thresholds configured
**File:** vitest.config.ts (7 lines)
**Description:** No coverage provider, no thresholds, no CI test step. CI only builds and packages.
**Recommendation:** Add v8 coverage provider and a test step to CI workflow.

#### [MINOR] T-014: Main.ts session restore logic is untested
**File:** electron/main.ts (429 lines)
**Description:** restoreAllSessions has dedup, 3s delays, resume-then-fallback — all untested.
**Recommendation:** Extract into testable module.

#### [MINOR] T-015: Preload script channel validation missing (test gap mirrors A-001)
**File:** electron/preload.ts (54 lines)
**Description:** No validChannels whitelist check despite CLAUDE.md claiming one exists.
**Recommendation:** Add validation and test it.
