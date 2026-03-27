---
name: skill-code
description: Fast implementation — no reviews. Gathers CPT context (shared types, relevant services, HTTP endpoints) in parallel, then coding agent implements, builds, and tests.
argument-hint: [task-description]
allowed-tools: Bash, Read, Glob, Grep, Task, AskUserQuestion
---

# Code Skill (Fast)

Parallel context gathering, then coding agent with aggregated context. No review pass — fastest path to implementation. For full pipeline with reviews use `/skill-implement`.

## Input

Task / feature description: $ARGUMENTS

## Workflow

### Phase 0: Parallel context gathering

Start these in parallel (all at once in a single message):

**Agent 1: explorer** — find relevant source files
```
Task(subagent_type="general-purpose", prompt="For the following CPT task, identify the relevant files to read before implementation.

Task: $ARGUMENTS

Search in:
- electron/ipc/ for relevant handler files
- electron/http/static-server.ts for matching HTTP endpoints
- src/shared/ for shared types and IPC channel constants
- src/src/app/services/ for Angular services that touch the same domain
- electron/analysis/ or electron/status/ if task relates to analysis or status detection

Return: file paths + one-line reason each is relevant. Max 8 files.")
```

**Agent 2: context-reader** — read key architectural files
```
Task(subagent_type="general-purpose", prompt="Read and summarize these CPT architecture files for a coding agent:

1. src/shared/ipc-channels.ts — list all defined constants
2. CLAUDE.md — extract Key Patterns section only

Return the channel list and the Key Patterns section verbatim. No other content.")
```

### Phase 1: coding agent with aggregated context

Wait for BOTH Phase 0 agents. Then start coding agent:

```
Task(subagent_type="coding-agent", prompt="
## Architecture Context
<Output from context-reader>

## Relevant Files
<Output from explorer — file paths and reasons>

## Task
$ARGUMENTS

## Verification Requirements
After implementation:
1. Run: npm run build:electron
   Must exit 0. Fix any TypeScript errors before returning.
2. Run: npx vitest run
   Must exit 0. Fix any test regressions before returning.

## CPT-Specific Rules
- IPC channels: always use IPC_CHANNELS constants from src/shared/ipc-channels.ts, never hardcode strings
- New channels need 4 edits: ipc-channels.ts + handler file + static-server.ts + Angular service (use /skill-add-ipc-channel pattern)
- Dual-transport: every IPC handler needs an HTTP mirror in electron/http/static-server.ts
- Angular services: dual-mode pattern — check window.electronAPI, fall back to fetch on port 9801
- Shared types: define in src/shared/, not duplicated across files
")
```

### Phase 1b: Escalation on build/test failure

If the coding agent returns with build or test failures it could not fix:

1. Run diagnostic in parallel:
   ```bash
   npm run build:electron 2>&1 | tail -30
   npx vitest run 2>&1 | tail -30
   ```

2. Feed error output back to coding agent with the specific failure context:
   ```
   Task(subagent_type="coding-agent", prompt="Fix the following build/test failures:
   <error output>
   Context: <original task>")
   ```

3. If still failing after one retry: escalate to user with all collected information.

### Phase 2: Completion

Present to the user:
- Status (DONE / PARTIAL / FAILED)
- Summary of changes
- Changed files
- Build and test results (pass/fail counts)

Ask for next steps:

```
AskUserQuestion:
- "Commit" — Create the commit
- "Show diff" — Show git diff
- "Run preflight" — Run /skill-preflight for full validation
- "Done" — No further action
```

## Important Rules

- **Phase 0 is PARALLEL** — both agents start simultaneously, not sequentially
- **No review pass** — fastest path to implementation. For reviews: /skill-implement
- **Build + test are mandatory** — coding agent must verify before returning DONE
- **Commit only with user approval** — never auto-commit
- **Specific git add** — never `git add .` or `git add -A`
- **No database context** — CPT has no DB. Skip any DB-related gathering.
