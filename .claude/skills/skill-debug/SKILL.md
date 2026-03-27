---
name: skill-debug
description: "Bug-hunting pipeline — takes a bug description, spawns explorer + debugger agents in parallel, identifies root cause, and offers a fix via coding agent."
argument-hint: "<bug description, error message, or component name>"
allowed-tools: Bash, Read, Glob, Grep, Task, AskUserQuestion
---

# Debug Pipeline Skill

You are a bug-hunting orchestrator for Claude PowerTerminal. You take a bug description, gather context via parallel agents, diagnose the root cause, and offer an automated fix.

## Input

Bug description, error message, or component name: $ARGUMENTS

## Pipeline Overview

```
┌──────────────────────────────────────────────────────────────┐
│  Phase 1: TRIAGE                                             │
│  Parse input → identify layer → collect error context        │
├──────────────────────────────────────────────────────────────┤
│  Phase 2: PARALLEL INVESTIGATION (2 agents simultaneously)   │
│  ┌─────────────────────┐   ┌──────────────────────────────┐  │
│  │  cpt-explorer       │   │  cpt-debugger                │  │
│  │  (haiku)            │   │  (sonnet)                    │  │
│  │  Find relevant      │   │  Diagnose root cause from    │  │
│  │  files + trace      │   │  error context               │  │
│  │  the call path      │   │                              │  │
│  └──────────┬──────────┘   └──────────────┬───────────────┘  │
│             └──────────────┬──────────────┘                  │
│                            ▼                                 │
├──────────────────────────────────────────────────────────────┤
│  Phase 3: RESULT + FIX OFFER                                 │
│  Present diagnosis → offer coding agent fix                  │
└──────────────────────────────────────────────────────────────┘
```

## Detailed Workflow

### Phase 1: Triage

Parse `$ARGUMENTS` and identify:

1. **Layer** — which CPT layer is likely involved:
   - `[HTTP]` / port 9801 → `electron/http/static-server.ts`
   - `[WebSocket]` / port 9800 / 4004 → `electron/websocket/ws-server.ts`
   - `[PTY]` / spawn / ENOENT → `electron/ipc/pty-handlers.ts`
   - `[Session]` / restore / sessions.json → `electron/ipc/session-handlers.ts`
   - IPC channel / invoke / undefined → `src/shared/ipc-channels.ts` + handler
   - Angular / service / component → `src/src/app/services/` or `components/`

2. **Error signal** — extract key terms: error message, file name, channel name, component

Output:
```
## Phase 1: Triage

- Layer: [identified layer]
- Error signal: [key terms]
- Files to investigate: [initial guesses]

Starting Phase 2: parallel investigation...
```

---

### Phase 2: Parallel Investigation

Start **exactly two agents simultaneously** (both in one message block):

#### Agent 1: cpt-explorer (file mapping)

```
Task(subagent_type="general-purpose", prompt="
Read the file .claude/agents/cpt-explorer.md for your complete instructions.

Task: Map the relevant files for this CPT bug.

Bug: $ARGUMENTS
Layer: [layer from Phase 1]
Error signal: [error terms from Phase 1]

Find and return:
1. The file(s) most likely containing the bug (with line references)
2. The full call path (Angular service → preload → IPC handler → HTTP mirror, or WS chain)
3. Any related shared types in src/shared/

Max 8 files. Return file paths + one-line reason each.
")
```

#### Agent 2: cpt-debugger (diagnosis)

```
Task(subagent_type="general-purpose", prompt="
Read the file .claude/agents/cpt-debugger.md for your complete instructions.

Diagnose this CPT bug:

Bug description: $ARGUMENTS
Layer: [layer from Phase 1]
Error signal: [error terms from Phase 1]

Use the Error-to-Layer quick reference table in your instructions.
Read the target file(s) directly — do not read all layers.

Return:
- STATUS: ROOT CAUSE FOUND | HYPOTHESIS | UNCLEAR
- Your full diagnosis in the output format specified in your instructions
")
```

Wait for both agents to complete before continuing.

---

### Phase 3: Result + Fix Offer

#### Present diagnosis

```
## Debug Results

### Root Cause
- **Category**: [from debugger]
- **Cause**: [precise description]
- **Evidence**: [file:line, code quote]

### Relevant Files (from explorer)
| File | Role |
|------|------|
| path/to/file.ts:line | [one-line description] |

### Fix Recommendation
[Code suggestion from debugger]
```

If debugger returned `STATUS: HYPOTHESIS` or `STATUS: UNCLEAR`: mention what additional information would be needed and offer to run a second diagnostic pass with a more targeted focus.

#### Offer next steps

```
AskUserQuestion with options:
- "Fix it" — spawn coding agent with full diagnosis context
- "Show me the file" — print the relevant code section
- "More investigation" — re-run debugger with specific focus area
- "I'll fix it manually" — present diagnosis as reference, done
```

#### If "Fix it" is selected

```
Task(subagent_type="coding-agent", prompt="
## Bug Diagnosis
[Full diagnosis from Phase 2 debugger agent]

## Relevant Files
[File list from Phase 2 explorer agent]

## Task
Fix the bug described in the diagnosis. Apply the recommended fix.

## Verification
After the fix:
1. Run: npm run build:electron
   Must exit 0.
2. Run: npx vitest run
   Must exit 0.

## CPT Rules
- IPC channels: always use IPC_CHANNELS constants, never hardcode strings
- Dual-transport: if you add an IPC handler, add the HTTP mirror in static-server.ts
- Shared types: define in src/shared/, not duplicated
- Never git add . or git add -A — use specific file paths
")
```

After coding agent completes, show:
- Status (FIXED / PARTIAL / FAILED)
- Changed files
- Build + test results

---

## Important Rules

- **Phase 2 agents MUST run in parallel** — one message block, two Task calls
- **Debugger agent never edits code** — diagnosis only
- **Coding agent does the fix** — clean separation of concerns
- **Do not auto-commit** — always ask user before committing
- **Custom agents via general-purpose** — always `subagent_type="general-purpose"` with agent file as prompt instruction
