---
phase: 01-core-pty-infrastructure
plan: 03
subsystem: session-management
tags: [ui, auto-restore, scrollback, session-lifecycle]
dependency_graph:
  requires: [01-01, 01-02]
  provides: [session-creation-ui, auto-restore, scrollback-buffer]
  affects: [electron-main, angular-services, session-components]
tech_stack:
  added: [rxjs-behaviorsubject, crypto-randomuuid]
  patterns: [circular-buffer, staggered-spawn, resume-fallback]
key_files:
  created:
    - src/src/app/services/pty-manager.service.ts
    - src/src/app/services/session-state.service.ts
    - src/src/app/services/scrollback-buffer.service.ts
    - src/src/app/components/session-create/session-create.component.ts
    - src/src/app/components/session-create/session-create.component.html
    - src/src/app/components/session-create/session-create.component.css
  modified:
    - electron/main.ts
    - electron/ipc/pty-handlers.ts
key_decisions:
  - decision: Use browser crypto.randomUUID() instead of Node.js crypto module
    rationale: Angular runs in browser context without Node.js crypto access
    impact: Session ID generation works correctly in renderer process
  - decision: Spawn via cmd.exe /c claude instead of direct claude spawn
    rationale: Windows PATH resolution requires command interpreter for reliable spawning
    impact: All PTY spawns now work consistently across Windows environments
  - decision: Add isDestroyed() guards on all IPC sends to renderer
    rationale: Prevents IPC send failures when window is closed during cleanup
    impact: Clean shutdown without error spam in logs
  - decision: Implement isCleaningUp flag to prevent recursive will-quit handlers
    rationale: Graceful shutdown was triggering multiple quit attempts
    impact: Shutdown is now stable without recursive loops
metrics:
  duration_minutes: 25
  tasks_completed: 4
  files_created: 6
  files_modified: 2
  commits: 3
  completed_at: 2026-02-24T08:01:41Z
---

# Phase 1 Plan 3: Session Management UI & Restore Summary

**One-liner:** User-facing session creation UI with auto-restore on startup, staggered spawning, resume fallback, and circular scrollback buffer for memory-safe terminal output

## What Was Built

Complete session lifecycle from creation through persistence to auto-restore:

1. **Angular Services Layer** (Task 1)
   - `PtyManagerService`: IPC wrapper for PTY operations (spawn, kill, write, output/exit listeners)
   - `SessionStateService`: RxJS-based reactive state management with BehaviorSubject for session map
   - `ScrollbackBuffer`: Circular buffer class (10k lines) preventing unbounded memory growth

2. **Session Creation UI** (Task 2)
   - `SessionCreateComponent`: Form with directory selection (dropdown + freetext), CLI flags (checkboxes + custom input)
   - Generates UUID session IDs, spawns PTY via IPC, persists metadata, updates reactive state
   - Material Design styling with responsive layout

3. **Auto-Restore Logic** (Task 3)
   - `restoreAllSessions()` in Electron main process
   - Loads sessions.json on app startup
   - Attempts `--resume` for each saved session with 2-second stagger delay
   - Falls back to fresh session in same directory if resume fails
   - Transparent recovery mechanism fulfilling SESS-03 requirement

4. **Manual Verification & Bugfixes** (Task 4)
   - Comprehensive testing confirmed all requirements: session creation, persistence, auto-restore, clean shutdown
   - Several critical bugfixes applied (see Deviations section)
   - No orphaned conhost.exe processes verified via Task Manager testing

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed browser crypto API usage in session-create.component.ts**
- **Found during:** Task 2 execution
- **Issue:** Import statement `import { randomUUID } from 'crypto'` failed — crypto module doesn't exist in browser context
- **Fix:** Replaced with native browser API `crypto.randomUUID()` which is available in Angular renderer process
- **Files modified:** `src/src/app/components/session-create/session-create.component.ts`
- **Commit:** 11f9ff4 (included in Task 2 commit)

**2. [Rule 1 - Bug] Fixed Windows PATH resolution in pty-handlers.ts**
- **Found during:** Manual verification (Task 4)
- **Issue:** Direct spawn of `claude` executable failed — Windows doesn't resolve PATH for direct spawn without shell
- **Fix:** Changed spawn to `cmd.exe /c claude` which invokes command interpreter for proper PATH resolution
- **Additional changes:** Added cwd validation to check directory exists before spawn; added `isDestroyed()` guards on IPC sends to prevent errors during shutdown
- **Files modified:** `electron/ipc/pty-handlers.ts`
- **Commit:** a7ae7c9 (included in Task 3 commit after testing feedback)

**3. [Rule 1 - Bug] Fixed Windows PATH resolution in main.ts**
- **Found during:** Manual verification (Task 4)
- **Issue:** Both `spawnPtyWithResume` and `spawnPtyFresh` helper functions had same Windows PATH issue
- **Fix:** Changed both spawn calls to use `cmd.exe /c claude` pattern
- **Additional changes:** Added `isDestroyed()` guards on all IPC sends to renderer; implemented `isCleaningUp` flag to prevent recursive will-quit event handling
- **Files modified:** `electron/main.ts`
- **Commit:** a7ae7c9 (included in Task 3 commit after testing feedback)

**4. [Rule 2 - Missing Critical] Added IPC send guards during shutdown**
- **Found during:** Manual verification (Task 4)
- **Issue:** During app shutdown, PTY exit handlers tried to send IPC to destroyed renderer window, causing error spam
- **Fix:** Added `if (!win.isDestroyed())` checks before all `win.webContents.send()` calls
- **Files modified:** `electron/ipc/pty-handlers.ts`, `electron/main.ts`
- **Commit:** a7ae7c9 (included in Task 3 commit after testing feedback)

**5. [Rule 1 - Bug] Fixed recursive quit handler in main.ts**
- **Found during:** Manual verification (Task 4)
- **Issue:** Graceful shutdown triggered `will-quit` multiple times recursively
- **Fix:** Added `isCleaningUp` boolean flag that prevents re-entry into cleanup logic
- **Files modified:** `electron/main.ts`
- **Commit:** a7ae7c9 (included in Task 3 commit after testing feedback)

All deviations were auto-fixed under Rules 1-2 (bugs and missing critical functionality). No architectural changes required.

## Requirements Fulfilled

- **SESS-01**: User can create sessions from UI — ✓ Verified
- **SESS-02**: Sessions auto-restore on app startup — ✓ Verified with --resume flag
- **SESS-03**: Resume failures fall back to fresh session — ✓ Verified with transparent fallback
- **TERM-01**: User can spawn Claude CLI sessions — ✓ Verified via cmd.exe /c claude spawn
- **TERM-04**: User can close sessions cleanly — ✓ Verified no orphaned conhost.exe processes

## Technical Highlights

**Circular Buffer Implementation:**
```typescript
class ScrollbackBuffer {
  private buffer: string[] = [];
  private head = 0;
  private readonly maxLines: number;

  append(line: string): void {
    if (this.buffer.length < this.maxLines) {
      this.buffer.push(line);
    } else {
      this.buffer[this.head] = line;
      this.head = (this.head + 1) % this.maxLines;
    }
  }
}
```
Prevents unbounded memory growth with fixed 10k line limit.

**Staggered Spawn Pattern:**
```typescript
for (const session of sessions) {
  await restoreSession(session);
  await new Promise(resolve => setTimeout(resolve, 2000)); // 2s delay
}
```
Avoids CPU spike from simultaneous Claude CLI spawns on startup.

**Resume Fallback Pattern:**
```typescript
try {
  await spawnPtyWithResume(sessionId, cwd, flags);
} catch (error) {
  console.warn(`Resume failed for ${sessionId}, starting fresh`);
  await spawnPtyFresh(sessionId, cwd, flags);
}
```
Transparent recovery when --resume fails (corrupted state, deleted data).

## Test Results

**Manual Verification (Task 4):**
- ✓ Session creation UI functional with directory + flags input
- ✓ PTY spawns correctly via cmd.exe /c claude (Windows PATH resolved)
- ✓ Sessions persist immediately to sessions.json in AppData
- ✓ Auto-restore works on app restart with 2-second stagger
- ✓ Resume fallback to fresh session confirmed (tested with invalid session ID)
- ✓ Clean shutdown kills all PTY processes without orphaned conhost.exe
- ✓ No AttachConsole errors during shutdown (fixed with isDestroyed guards)

**User Approval:**
> "approved — User tested and confirmed: Session creation works (PTY spawns correctly via cmd.exe /c claude), Sessions persist to sessions.json in AppData, Auto-restore works on app restart (resume + fallback to fresh), Clean shutdown kills all PTY processes without orphaned processes, No more AttachConsole errors during shutdown"

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | 2615888 | feat(01-03): create Angular services for PTY and session state management |
| 2 | 11f9ff4 | feat(01-03): create session creation UI component |
| 3 | a7ae7c9 | feat(01-03): implement auto-restore logic for session recovery |

## Files Changed

**Created (6 files, 1257 lines added):**
- `src/src/app/services/pty-manager.service.ts` (167 lines) — IPC wrapper for PTY operations
- `src/src/app/services/session-state.service.ts` (218 lines) — Reactive session state management
- `src/src/app/services/scrollback-buffer.service.ts` (141 lines) — Circular buffer for terminal output
- `src/src/app/components/session-create/session-create.component.ts` (245 lines) — Session creation form logic
- `src/src/app/components/session-create/session-create.component.html` (95 lines) — Session creation template
- `src/src/app/components/session-create/session-create.component.css` (144 lines) — Material Design styling

**Modified (2 files, 252 lines added):**
- `electron/main.ts` (+239 lines) — Auto-restore logic with resume fallback
- `electron/ipc/pty-handlers.ts` (+13 lines) — Windows spawn fix and IPC guards

## Next Steps

Phase 1 complete. All requirements (TERM-01, TERM-04, SESS-01, SESS-02, SESS-03) fulfilled and verified.

**Immediate next phase:** Phase 2 — WebSocket Bridge & UI
- Stream PTY output to browser via WebSocket
- Integrate xterm.js for terminal rendering
- Implement full interactive I/O (input from browser to PTY)
- Handle scrollback replay on reconnect
- Support terminal resize events

## Self-Check: PASSED

**Files created:**
- ✓ FOUND: src/src/app/services/pty-manager.service.ts
- ✓ FOUND: src/src/app/services/session-state.service.ts
- ✓ FOUND: src/src/app/services/scrollback-buffer.service.ts
- ✓ FOUND: src/src/app/components/session-create/session-create.component.ts
- ✓ FOUND: src/src/app/components/session-create/session-create.component.html
- ✓ FOUND: src/src/app/components/session-create/session-create.component.css

**Files modified:**
- ✓ FOUND: electron/main.ts
- ✓ FOUND: electron/ipc/pty-handlers.ts

**Commits:**
- ✓ FOUND: 2615888 (Task 1)
- ✓ FOUND: 11f9ff4 (Task 2)
- ✓ FOUND: a7ae7c9 (Task 3)
