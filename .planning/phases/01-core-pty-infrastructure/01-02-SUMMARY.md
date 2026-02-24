---
phase: 01-core-pty-infrastructure
plan: 02
subsystem: pty-lifecycle
tags: [node-pty, windows-process-management, ipc-handlers, process-cleanup]
dependency_graph:
  requires: [project-structure, session-persistence-api, ipc-infrastructure]
  provides: [pty-spawn-capability, pty-kill-capability, pty-io-capability, windows-process-cleanup]
  affects: [terminal-ui, session-restore, terminal-management]
tech_stack:
  added: []
  patterns: [graceful-then-force-kill, environment-sanitization, map-based-tracking]
key_files:
  created:
    - electron/utils/process-cleanup.ts
    - electron/ipc/pty-handlers.ts
    - electron/ipc/session-handlers.ts
  modified:
    - electron/main.ts
    - src/shared/ipc-channels.ts
decisions:
  - key: force-kill-timeout
    choice: 3000ms (3 seconds)
    rationale: Balances responsiveness with allowing Claude CLI time to shut down gracefully
  - key: windows-kill-strategy
    choice: taskkill with /T /F flags
    rationale: /T terminates process tree (prevents orphaned conhost.exe), /F forces termination
  - key: environment-sanitization
    choice: Delete CLAUDECODE and CLAUDECODE_SESSION_ID before spawn
    rationale: Prevents nested Claude CLI session conflicts
  - key: pty-process-tracking
    choice: Map<sessionId, IPty> in pty-handlers module
    rationale: Simple, efficient lookup by session ID, automatic cleanup on exit
metrics:
  duration_minutes: 2
  task_count: 3
  commit_count: 3
  files_created: 3
  files_modified: 2
  lines_added: 344
completed: 2026-02-24T08:29:10Z
---

# Phase 01 Plan 02: PTY Lifecycle Management Summary

**One-liner:** PTY spawning, I/O, and Windows-safe termination with environment sanitization and taskkill-based process tree cleanup

## Overview

Implemented the core PTY lifecycle management by creating IPC handlers that spawn, manage, and terminate Claude CLI processes with Windows-specific workarounds. This enables the renderer process to control PTY processes safely through Electron's IPC bridge, providing the foundation for terminal management.

## What Was Built

### Task 1: Create Windows-specific process cleanup utility
- Created `killPtyProcess` function in `electron/utils/process-cleanup.ts`
- Implemented graceful-then-force kill pattern:
  1. Attempts graceful kill via `ptyProcess.kill()`
  2. Waits for process exit with configurable timeout (default 3000ms)
  3. If timeout expires, force-kills on Windows using `taskkill /PID <pid> /T /F`
- Windows taskkill flags:
  - `/T` - Terminates process tree (kills conhost.exe children)
  - `/F` - Forces termination
- Error handling: Catches and logs taskkill errors (expected when process already terminated)
- Logging: Comprehensive logging at each stage (graceful attempt, timeout, force-kill, success)
- Cross-platform: Graceful kill only on non-Windows platforms

**Commit:** `d232271`

### Task 2: Implement PTY IPC handlers
- Created `registerPtyHandlers` function in `electron/ipc/pty-handlers.ts`
- Implemented Map-based PTY process tracking: `Map<string, IPty>`
- Defined interfaces:
  - `PTYSpawnOptions` - sessionId, cwd, flags
  - `PTYWriteOptions` - sessionId, data

**Handler 1: PTY_SPAWN**
- Spawns Claude CLI with `pty.spawn('claude', ['--session-id', sessionId, ...flags])`
- Environment sanitization:
  ```typescript
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDECODE_SESSION_ID;
  ```
- PTY configuration:
  - `name: 'xterm-256color'` - Terminal type
  - `cols: 80, rows: 30` - Initial size
  - `cwd` - Working directory from options
  - `useConpty: true` - Windows ConPTY mode
- Output streaming: `ptyProcess.onData` → `event.sender.send(PTY_DATA)`
- Exit handling: `ptyProcess.onExit` → `event.sender.send(PTY_EXIT)` + cleanup from map
- Returns: `{ success: true, pid: ptyProcess.pid }`

**Handler 2: PTY_KILL**
- Retrieves PTY from map by sessionId
- Calls `killPtyProcess` with 3-second timeout
- Removes from map after termination
- Returns: `{ success: true }` or `{ success: false, error: 'Session not found' }`

**Handler 3: PTY_WRITE**
- Retrieves PTY from map by sessionId
- Writes data via `ptyProcess.write(data)`
- Returns: `{ success: true }` or `{ success: false, error: 'Session not found' }`

**Auto-fixed issue: Added PTY_WRITE channel to IPC_CHANNELS**
- Plan specified PTY_WRITE handler but channel wasn't defined
- Added `PTY_WRITE: 'pty:write'` to `src/shared/ipc-channels.ts`
- Fixed via Rule 3 (blocking issue - handler couldn't be implemented without channel)

**Commit:** `b917505`

### Task 3: Implement session persistence IPC handlers and wire up main.ts
- Created `registerSessionHandlers` function in `electron/ipc/session-handlers.ts`
- Moved session persistence logic from inline handlers in main.ts to dedicated module
- Defined `SessionMetadata` interface (matches Angular model)

**Helper functions:**
- `getSessionsFilePath()` - Returns path to sessions.json in userData directory
- `loadSessionsFromDisk()` - Reads JSON file, returns empty array on error
- `saveSessionsToDisk()` - Writes JSON file synchronously with `fs.writeFileSync`

**Handler 1: SESSION_SAVE**
- Loads existing sessions
- Appends new session to array
- Saves to disk immediately (synchronous write for durability)
- Returns: `{ success: true }` or `{ success: false, error: ... }`

**Handler 2: SESSION_LOAD**
- Loads all sessions from disk
- Returns: `{ success: true, sessions: SessionMetadata[] }`

**Handler 3: SESSION_DELETE**
- Filters out session by ID
- Saves updated array to disk
- Returns: `{ success: true }` or `{ success: false, error: ... }`

**Updated electron/main.ts:**
- Removed inline session handler functions (moved to session-handlers.ts)
- Removed old `setupIPCHandlers()` function
- Added imports for `registerPtyHandlers` and `registerSessionHandlers`
- Calls both registration functions in `app.whenReady()` before creating window:
  ```typescript
  app.whenReady().then(() => {
    registerPtyHandlers();
    registerSessionHandlers();
    createWindow();
  });
  ```
- Cleaned up imports: Removed `ipcMain`, `fs`, `IPC_CHANNELS` (no longer needed in main.ts)

**Commit:** `87400a8`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Added PTY_WRITE channel to IPC_CHANNELS**
- **Found during:** Task 2
- **Issue:** Plan specified PTY_WRITE handler implementation, but PTY_WRITE channel wasn't defined in IPC_CHANNELS constant
- **Fix:** Added `PTY_WRITE: 'pty:write'` to `src/shared/ipc-channels.ts`
- **Files modified:** `src/shared/ipc-channels.ts`
- **Commit:** `b917505` (Task 2)
- **Justification:** Without the channel constant, couldn't implement the PTY_WRITE handler. This was a blocking issue preventing task completion, so auto-fixed per Rule 3.

## Verification Results

✅ **TypeScript compilation succeeds** - All electron files compile without errors
✅ **File structure verified** - pty-handlers.ts, session-handlers.ts, process-cleanup.ts exist
✅ **main.ts registration** - Both `registerPtyHandlers()` and `registerSessionHandlers()` called in app.whenReady()
✅ **killPtyProcess implementation** - Timeout pattern with `Promise.race`, taskkill with /T /F flags
✅ **IPC channels** - All handlers use `IPC_CHANNELS` constants (PTY_SPAWN, PTY_WRITE, PTY_KILL, PTY_DATA, PTY_EXIT, SESSION_SAVE, SESSION_LOAD, SESSION_DELETE)
✅ **Environment sanitization** - CLAUDECODE vars deleted before PTY spawn
✅ **Map-based tracking** - `Map<string, IPty>` for PTY process management
✅ **Synchronous file writes** - `fs.writeFileSync` used for session persistence

## Technical Achievements

1. **Windows-safe process termination**: Graceful-then-force pattern prevents orphaned conhost.exe processes
2. **Environment sanitization**: Nested Claude CLI sessions now possible by removing CLAUDECODE vars
3. **IPC-based architecture**: All PTY operations go through main process, renderer stays secure
4. **Immediate session persistence**: Synchronous writes ensure durability, no data loss on crash
5. **Modular handler registration**: Clean separation of concerns (PTY vs session handlers)
6. **Comprehensive logging**: All operations logged for debugging

## Known Limitations

1. **Fixed terminal size**: PTY spawned with 80x30, no resize handling yet (planned for Phase 2)
2. **No session restore on startup**: Session loading implemented but not auto-restore logic (planned for next plan)
3. **No PTY cleanup on app quit**: TODO comment in main.ts - need to kill all active PTYs before quit
4. **No staggered spawn**: Will need to implement delay between spawns for session restore (planned for next plan)
5. **SESSION_GET handler removed**: Old handler existed in main.ts, not reimplemented in session-handlers.ts (not in plan requirements, can add later if needed)

## Next Steps

Following the plan in `.planning/phases/01-core-pty-infrastructure/01-03-PLAN.md`:
1. Implement session auto-restore on app startup via `--resume` flag
2. Add staggered spawning (2 second delay between sessions)
3. Implement fallback to fresh session if `--resume` fails
4. Add PTY cleanup on app quit to prevent orphaned processes
5. Test full session lifecycle (create, save, restart app, auto-restore)

## File Manifest

**Created files (3):**
- `electron/utils/process-cleanup.ts` (75 lines) - Windows-specific PTY kill logic with graceful-then-force pattern
- `electron/ipc/pty-handlers.ts` (134 lines) - PTY spawn/kill/write IPC handlers with Map-based tracking
- `electron/ipc/session-handlers.ts` (127 lines) - Session save/load/delete IPC handlers with synchronous persistence

**Modified files (2):**
- `electron/main.ts` (-73 lines, +7 lines) - Removed inline session handlers, added handler registration calls
- `src/shared/ipc-channels.ts` (+1 line) - Added PTY_WRITE channel constant

## Dependencies Added

None (all dependencies already present from Phase 01 Plan 01)

## Self-Check: PASSED

✅ All created files exist:
- FOUND: electron/utils/process-cleanup.ts (2717 bytes)
- FOUND: electron/ipc/pty-handlers.ts (4382 bytes)
- FOUND: electron/ipc/session-handlers.ts (4027 bytes)

✅ All modified files exist:
- FOUND: electron/main.ts (updated)
- FOUND: src/shared/ipc-channels.ts (updated)

✅ All commits exist:
- FOUND: d232271 (Task 1: Windows-specific process cleanup utility)
- FOUND: b917505 (Task 2: PTY IPC handlers)
- FOUND: 87400a8 (Task 3: Session persistence handlers and main.ts update)

✅ TypeScript compilation succeeds (electron directory)

✅ Key patterns verified:
- killPtyProcess function exports and implements graceful-then-force pattern
- taskkill with /T /F flags present in process-cleanup.ts
- registerPtyHandlers called in main.ts
- IPC_CHANNELS constants used throughout

✅ All verification criteria met
