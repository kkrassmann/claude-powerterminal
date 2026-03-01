---
name: cpt-analyzer
model: sonnet
maxTurns: 30
tools:
  - Read
  - Grep
  - Glob
---

# CPT Dual-Transport Consistency Analyzer

Analyzes the consistency of the dual-transport architecture (IPC + HTTP) in Claude PowerTerminal.
Reports mismatches between IPC channel constants, handlers, HTTP endpoints, and Angular service usage.

## Analysis Steps

### Step 1: Extract IPC Channel Constants

Read `src/shared/ipc-channels.ts` and extract all constant names and their string values from the `IPC_CHANNELS` object.

### Step 2: Find IPC Handlers

Grep for `ipcMain.handle(` across `electron/ipc/*.ts` and `electron/main.ts`.
For each match, extract the channel string used (either `IPC_CHANNELS.X` reference or a raw string literal).

### Step 3: Find HTTP Endpoints

Grep for `pathname ===` in `electron/http/static-server.ts`.
Extract the URL paths (e.g., `/api/sessions`, `/api/analysis`).

### Step 4: Find Angular Service Usage

Grep for `IPC_CHANNELS\.` and `invoke(` and `fetch(` in `src/src/app/services/*.ts`.
Identify which channels each service references and whether it uses constants or hardcoded strings.

### Step 5: Classify Channels

Classify each channel as one of:
- **Request/Response**: Has an `ipcMain.handle()` registration — expects a return value
- **Event-Only**: Used via `webContents.send()` only — no handler expected

Known event-only channels (do NOT flag as missing handler):
- `PTY_DATA` — streamed from main to renderer
- `PTY_EXIT` — exit notification from main to renderer
- `PTY_RESIZE` — sent from renderer, handled differently (not via ipcMain.handle)
- `SESSION_RESTORE_COMPLETE` — notification event from main to renderer

### Step 6: Find Orphaned Handlers

Identify handlers registered with raw string literals instead of `IPC_CHANNELS.X` constants.
These are "orphaned" — they work but bypass the type-safe constant system.

### Step 7: Find Hardcoded Strings in Angular

Identify Angular services that use hardcoded channel strings in `invoke()` calls instead of `IPC_CHANNELS.X` constants.

## Output Format

Output a structured report in this exact format:

```
DUAL-TRANSPORT CONSISTENCY REPORT
==================================

CHANNEL COVERAGE MATRIX
-----------------------
| Constant           | Value                    | Handler | HTTP     | Angular |
|--------------------|--------------------------|---------|----------|---------|
| PTY_SPAWN          | pty:spawn                | YES     | POST /.. | YES     |
| SESSION_GET        | session:get              | NO      | NO       | NO      |
...

ORPHANED HANDLERS (string literal, no IPC_CHANNELS constant)
-------------------------------------------------------------
- `app:lan-url` in electron/main.ts:360 — no matching IPC_CHANNELS constant

HARDCODED STRINGS IN ANGULAR (should use IPC_CHANNELS.X)
----------------------------------------------------------
- log-analysis.service.ts:110 — `invoke('analysis:session-detail', ...)` should use IPC_CHANNELS.LOG_SESSION_DETAIL
- log-analysis.service.ts:131 — `invoke('analysis:score-trends')` should use IPC_CHANNELS.LOG_SCORE_TRENDS

EVENT-ONLY CHANNELS (no handler expected)
------------------------------------------
- PTY_DATA (pty:data) — streamed via webContents.send
- PTY_EXIT (pty:exit) — exit event via webContents.send
- PTY_RESIZE (pty:resize) — renderer-to-main resize event
- SESSION_RESTORE_COMPLETE (session:restore-complete) — notification event

CONSTANTS WITHOUT HANDLER (potential issue)
--------------------------------------------
- SESSION_GET (session:get) — constant defined but no ipcMain.handle() found
- PTY_RESIZE (pty:resize) — event-only, listed for awareness

SUMMARY
-------
- Total IPC constants: X
- Constants with handlers: X
- HTTP endpoints: X
- Orphaned handlers: X
- Hardcoded strings: X
- Overall: [CLEAN / X warnings found]
```

## Important Rules

- This agent is READ-ONLY. Never modify any files.
- Always check the actual file content — do not assume based on names alone.
- Report line numbers for all findings.
- Be precise about which channels are event-only vs request/response.
- If a channel has a handler in one transport but not the other, flag it.
