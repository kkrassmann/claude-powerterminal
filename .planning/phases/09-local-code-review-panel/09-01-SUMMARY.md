---
phase: 09-local-code-review-panel
plan: "01"
subsystem: code-review
tags: [ipc, http-api, angular-service, git-diff, typescript]
dependency_graph:
  requires: []
  provides:
    - Review IPC channel constants (REVIEW_DIFF, REVIEW_REJECT_HUNK, REVIEW_REJECT_FILE)
    - Shared TypeScript types for diff/review state (code-review.model.ts)
    - IPC handlers for git diff and reject operations (review-handlers.ts)
    - HTTP API mirrors for remote browser access (/api/review/*)
    - Angular CodeReviewService with dual-transport routing
  affects:
    - electron/main.ts (handler registration)
    - src/shared/ipc-channels.ts (new constants)
    - electron/http/static-server.ts (new endpoints)
tech_stack:
  added: []
  patterns:
    - dual-transport IPC+HTTP pattern (mirrors log-analysis.service.ts)
    - spawn+stdin for git apply --reverse (execFile cannot write stdin)
    - in-memory Map-based state keyed by sessionId
key_files:
  created:
    - src/src/app/models/code-review.model.ts
    - electron/ipc/review-handlers.ts
    - src/src/app/services/code-review.service.ts
  modified:
    - src/shared/ipc-channels.ts
    - electron/main.ts
    - electron/http/static-server.ts
decisions:
  - id: REVIEW-D1
    summary: "Use spawn+stdin for review:reject-hunk — execFile does not support stdin input, only spawn does"
  - id: REVIEW-D2
    summary: "git diff HEAD covers both staged+unstaged; fallback to --cached for repos with no prior commits"
  - id: REVIEW-D3
    summary: "In-memory comment/state management in Angular service — no persistence needed for review session"
  - id: REVIEW-D4
    summary: "PROJECT_TYPES layerOrder: angular=[routes,components,services,models,shared,tests], express-api=[routes,controllers,managers,brokers,models,middleware,tests]"
metrics:
  duration_minutes: 3
  completed_date: "2026-03-02"
  tasks_completed: 2
  files_created: 3
  files_modified: 3
---

# Phase 9 Plan 01: Backend Foundation for Code Review Panel Summary

**One-liner:** Git diff/reject IPC+HTTP transport layer with Angular dual-mode service and in-memory comment/state management.

## What Was Built

The complete backend foundation for the code review panel:

1. **Shared types** (`code-review.model.ts`): `ReviewComment`, `ReviewFileStatus`, `ReviewHunkState`, `ReviewFileState`, `ProjectType`, `PROJECT_TYPES` array, plus `detectProjectType()` and `sortFilesByLayer()` utility functions for intelligent file ordering.

2. **IPC handlers** (`review-handlers.ts`): Three handlers registered via `registerReviewHandlers()`:
   - `review:diff` — `git diff HEAD --unified=3` with 10 MB buffer, 15s timeout, fallback to `--cached`
   - `review:reject-hunk` — `git apply --reverse --unidiff-zero` via `spawn` + stdin (NOT execFile)
   - `review:reject-file` — `git checkout HEAD -- <file>` with 5s timeout

3. **HTTP API** (`static-server.ts`): Three mirrored endpoints for remote browser support:
   - `GET /api/review/diff?cwd=<path>`
   - `POST /api/review/reject-hunk` (JSON body: `{ cwd, patchContent }`)
   - `POST /api/review/reject-file` (JSON body: `{ cwd, filePath }`)

4. **Angular service** (`code-review.service.ts`): Dual-transport `CodeReviewService` with:
   - `fetchDiff()`, `rejectHunk()`, `rejectFile()` — IPC in Electron, HTTP fetch in remote browser
   - Comment state: `addComment()`, `getComments()`, `getCommentsForFile()`, `toggleResolved()`, `removeComment()`, `clearSession()`
   - File review state: `initFileState()`, `getFileState()`, `setHunkState()`, `setFileReviewed()`, `getAllFileStates()`

## Deviations from Plan

None — plan executed exactly as written.

## Decisions Made

| ID | Decision |
|----|----------|
| REVIEW-D1 | `review:reject-hunk` uses `spawn` (not `execFile`) — stdin write is only possible with spawn |
| REVIEW-D2 | `git diff HEAD` as primary diff source; `--cached` as fallback for brand-new repos |
| REVIEW-D3 | In-memory comment state in Angular service (no persistence) |
| REVIEW-D4 | Layer order constants defined in plan frontmatter, encoded in `PROJECT_TYPES` array |

## Verification

- TypeScript compilation: 0 errors (Angular side + Electron side)
- All 112 existing unit tests pass
- 3 IPC channel constants present in `ipc-channels.ts`
- `registerReviewHandlers` imported and called in `main.ts`
- 3 HTTP endpoints present in `static-server.ts`
- `fetchDiff`, `rejectHunk`, `rejectFile`, `addComment` methods present in service

## Self-Check: PASSED

Files created:
- `src/src/app/models/code-review.model.ts` FOUND
- `electron/ipc/review-handlers.ts` FOUND
- `src/src/app/services/code-review.service.ts` FOUND

Commits:
- `9be7742` FOUND
- `70733d7` FOUND
