---
phase: 03-dashboard-grid
plan: 01
subsystem: git-context
tags: [git, ipc, polling, data-pipeline]
dependency_graph:
  requires: [ipc-channels, preload-api]
  provides: [git-context-data, home-dir-access]
  affects: [terminal-tiles]
tech_stack:
  added: [git-rev-parse, git-status-porcelain, execFile-with-timeout]
  patterns: [ipc-handler-registration, 30s-polling-service, change-detection]
key_files:
  created:
    - src/src/app/models/git-context.model.ts
    - electron/ipc/git-handlers.ts
    - src/src/app/services/git-context.service.ts
  modified:
    - src/shared/ipc-channels.ts
    - electron/main.ts
key_decisions:
  - decision: Use execFile instead of exec for git commands
    rationale: No shell injection risk, lower overhead, safer for untrusted paths
  - decision: 5-second timeout on git commands
    rationale: Prevents hangs on large repos or slow filesystems, fails fast with safe defaults
  - decision: Parse git status --porcelain instead of using isomorphic-git
    rationale: Simpler, faster, no large dependencies, git CLI already required for Claude
  - decision: Duplicate GitContext interface in main process
    rationale: Main process can't import from Angular src, 5 fields is acceptable duplication
  - decision: Silent failure on individual session poll errors
    rationale: One bad repo shouldn't break polling for all sessions, keep previous value
  - decision: 30-second polling interval
    rationale: Balance between freshness and system load, git commands are cheap but not free
  - decision: Detect count changes for highlight animations
    rationale: Users need visual feedback when change counts update, serialize counts for comparison
metrics:
  duration: 3.6 minutes
  tasks_completed: 2
  files_created: 3
  files_modified: 2
  commits: 2
  completed_at: 2026-02-24
---

# Phase 03 Plan 01: Git Context Data Pipeline Summary

**One-liner:** Git context IPC handlers with 30-second polling service providing branch name and change counts for terminal tiles.

## What Was Built

Built the complete Git context data pipeline from Electron main process to Angular service layer:

**Backend (Electron main process):**
- `git:context` IPC handler that runs `git rev-parse --abbrev-ref HEAD` and `git status --porcelain` in parallel
- Parses porcelain output to count added/modified/deleted files
- 5-second timeout on git commands to prevent hangs
- `app:home-dir` IPC handler for path shortening in renderer (HOME/USERPROFILE env var)
- Safe defaults on errors: `{ branch: null, added: 0, modified: 0, deleted: 0, isGitRepo: false }`

**Frontend (Angular renderer):**
- GitContextService that tracks sessions by sessionId → cwd mapping
- Polls all tracked sessions every 30 seconds in parallel
- Detects count changes for highlight animation triggers (serializes `added:modified:deleted` for comparison)
- BehaviorSubject observable for reactive context updates
- Immediate poll on session tracking, cleanup on service destroy

**Model:**
- GitContext interface: `branch | null`, `added`, `modified`, `deleted`, `isGitRepo`

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Create Git context model, IPC handler, and register in main process | ba43ed6 | git-handlers.ts, git-context.model.ts, ipc-channels.ts, main.ts |
| 2 | Create GitContextService for polling git info per session | 6657226 | git-context.service.ts |

## Deviations from Plan

None - plan executed exactly as written.

## Key Technical Decisions

**1. execFile vs exec for git commands**
Used `execFile` instead of `exec` for zero shell injection risk and lower overhead. Passes git args as array, not shell command string.

**2. 5-second timeout strategy**
Set `timeout: 5000` on both git commands to prevent hangs on large repos (e.g., Linux kernel, chromium). On timeout, returns safe defaults with `isGitRepo: false`.

**3. Porcelain parsing approach**
Parses `git status --porcelain` XY columns: `?` or `A` → added, `M` → modified, `D` → deleted. Simple, fast, no dependencies.

**4. Interface duplication in main process**
Duplicated GitContext interface in `git-handlers.ts` because main process can't import from Angular src. Only 5 fields, acceptable trade-off vs complex shared types setup.

**5. Change detection mechanism**
Serializes change counts as `"added:modified:deleted"` string for comparison. When counts change, adds sessionId to `changedSessions` Set for 1500ms (animation duration). Components can check this Set to trigger highlight animations.

**6. Silent failure on poll errors**
Individual session poll failures log warning but keep previous value. Prevents one bad repo from breaking polling for all sessions.

## Architecture Notes

**Data Flow:**
```
Terminal tile subscribes to GitContextService.contexts$ BehaviorSubject
                    ↓
GitContextService polls every 30s via window.electronAPI.invoke(IPC_CHANNELS.GIT_CONTEXT, cwd)
                    ↓
Main process git-handlers.ts runs git commands with execFile + 5s timeout
                    ↓
Returns GitContext with branch name and change counts
                    ↓
Service detects count changes, triggers highlight animation via changedSessions Set
```

**Timeout Behavior:**
- Git commands run in parallel via `Promise.all` for speed
- Both commands have 5s timeout to prevent hangs
- On timeout or any error (not a git repo, git not installed), returns safe defaults
- Non-git directories return `isGitRepo: false` without errors

**Polling Strategy:**
- Polls immediately on service start and on session tracking
- Then every 30 seconds for all tracked sessions in parallel
- Untracking a session removes it from contexts map and stops polling it
- Service cleanup on destroy prevents memory leaks

## Testing Notes

**Manual Testing Performed:**
- Angular production build succeeds without errors
- TypeScript compilation passes
- IPC channel constants verified (no magic strings)
- Handler registration verified in main.ts

**Ready for Integration Testing:**
- Test git:context handler with git repo directory → should return branch and counts
- Test git:context handler with non-git directory → should return isGitRepo: false
- Test git:context handler with git command timeout (simulate slow filesystem) → should return safe defaults after 5s
- Test app:home-dir handler → should return HOME or USERPROFILE env var
- Test GitContextService polling → should update contexts$ every 30 seconds
- Test change detection → should add sessionId to changedSessions when counts change

## Next Steps

**Plan 02 (Terminal Tile Header):**
- Consume GitContextService.contexts$ observable in terminal tile header component
- Display branch name with git icon
- Display change counts (added/modified/deleted) with colored badges
- Trigger highlight animation when sessionId is in changedSessions Set
- Use app:home-dir for path shortening (replace home prefix with ~)

**Future Enhancements (not in current scope):**
- Add git remote tracking (ahead/behind counts)
- Add git stash count
- Add .gitignore rule count for untracked files
- Cache git context for 30s to avoid redundant calls if component re-renders

## Self-Check: PASSED

**Files Created:**
```
FOUND: src/src/app/models/git-context.model.ts
FOUND: electron/ipc/git-handlers.ts
FOUND: src/src/app/services/git-context.service.ts
```

**Files Modified:**
```
FOUND: src/shared/ipc-channels.ts (GIT_CONTEXT, APP_HOME_DIR constants added)
FOUND: electron/main.ts (registerGitHandlers call added)
```

**Commits:**
```
FOUND: ba43ed6 (Task 1: Git context IPC handlers and model)
FOUND: 6657226 (Task 2: GitContextService)
```

**Build Status:**
```
Angular production build: SUCCESS (with expected warnings about bundle size and xterm modules)
TypeScript compilation: SUCCESS
```

All artifacts verified on disk and in git history.
