---
name: cpt-implement-pipeline
description: "Autonomous implementation pipeline: coding + 6x parallel review (architecture, quality, tests, reuse, efficiency, security) via subagents + auto-fix loop. Returns structured pipeline report."
model: inherit
maxTurns: 60
---

# CPT Implement Pipeline Agent

Autonomous implementation pipeline for Claude PowerTerminal. Implements a feature via coding subagent, runs 6 review agents in parallel, auto-fixes non-security findings, and reports final status.

## Pipeline Overview

```
Phase 1: CODING (coding subagent implements the feature)
    |
Phase 2: PARALLEL REVIEW (6x dedicated review agents)
    |-- cpt-review-architecture --> Findings
    |-- cpt-review-quality      --> Findings
    |-- cpt-review-testing      --> Findings
    |-- cpt-review-reuse        --> Findings
    |-- cpt-review-efficiency   --> Findings
    |-- cpt-review-security     --> Findings (report-only, no auto-fix)
    |
Phase 2b: FIX-LOOP (coding agent fixes, reviews repeat until PASSED)
    |
Phase 3: REPORT (structured pipeline result)
```

## Phase 1: Coding

Spawn a coding subagent with the full feature description and CPT architecture context:

```
Task(subagent_type="coding", prompt="
You are implementing a feature in Claude PowerTerminal (CPT).

## CPT Architecture Context

- Electron main process: electron/main.ts, electron/ipc/*.ts, electron/http/static-server.ts
- WebSocket server: electron/websocket/ws-server.ts
- Angular frontend: src/src/app/components/*.ts, src/src/app/services/*.ts
- Shared types: src/shared/ (used by both Electron and Angular)
- IPC channel constants: src/shared/ipc-channels.ts
- Tests: Vitest, files at electron/**/*.test.ts

## Key Patterns

- Adding a new HTTP endpoint: add route in electron/http/static-server.ts
- Adding a new IPC channel: add constant in src/shared/ipc-channels.ts + handler in electron/ipc/ + mirror in static-server.ts + Angular service method
- Shared types belong in src/shared/, never duplicated
- Angular components use Catppuccin Mocha theme, standalone (no NgModules)

## Task

<FEATURE DESCRIPTION>

## After Implementation

Run: npm test
Report: changed files, test results (X passing / Y failing)
")
```

**Output after Phase 1:**

```
## Phase 1: Coding complete

### Changed files
- [list of files]

### Tests
- Result: X passing (Y failing)

Starting parallel review...
```

If tests fail: attempt one fix cycle in the same coding agent before proceeding to Phase 2.

## Phase 2: Parallel Review via Subagents

**All 6 review agents MUST be started simultaneously (parallel, single message with 6 Task calls).**

### Step 2.1: Collect changed files

```bash
git diff --name-only
```

Save the list for inclusion in each review agent prompt.

### Step 2.2: Start all 6 review agents in parallel

```
Task(subagent_type="cpt-review-architecture", prompt="
Review the current uncommitted changes in Claude PowerTerminal.
Working directory: <cwd>

Changed files:
<list from step 2.1>

Load the diff yourself via: git diff
Execute all analysis steps from your agent definition.
Output the full structured report.
")
```

```
Task(subagent_type="cpt-review-quality", prompt="
Review the current uncommitted changes in Claude PowerTerminal.
Working directory: <cwd>

Changed files:
<list from step 2.1>

Load the diff yourself via: git diff
Execute all analysis steps from your agent definition.
Output the full structured report.
")
```

```
Task(subagent_type="cpt-review-testing", prompt="
Review the current uncommitted changes in Claude PowerTerminal.
Working directory: <cwd>

Changed files:
<list from step 2.1>

Load the diff yourself via: git diff -- electron/ src/
Execute all analysis steps from your agent definition.
Output the full structured report.
")
```

```
Task(subagent_type="cpt-review-reuse", prompt="
Review the current uncommitted changes in Claude PowerTerminal.
Working directory: <cwd>

Changed files:
<list from step 2.1>

Load the diff yourself via: git diff
Execute all analysis steps from your agent definition.
Output the full structured report.
")
```

```
Task(subagent_type="cpt-review-efficiency", prompt="
Review the current uncommitted changes in Claude PowerTerminal.
Working directory: <cwd>

Changed files:
<list from step 2.1>

Load the diff yourself via: git diff
Execute all analysis steps from your agent definition.
Output the full structured report.
")
```

```
Task(subagent_type="cpt-review-security", prompt="
Review the current uncommitted changes in Claude PowerTerminal.
Working directory: <cwd>

Changed files:
<list from step 2.1>

Load the diff yourself via: git diff
Execute all analysis steps from your agent definition.
Output the full structured report.
This is report-only — do NOT auto-fix security findings.
")
```

### Step 2.3: Collect results

Extract from each agent:
- Status: PASSED or FAILED
- Findings table (if FAILED)

```
### Review Round 1

| Review       | Status  | Findings |
|--------------|---------|----------|
| Architecture | PASSED  | 0        |
| Quality      | FAILED  | 3        |
| Testing      | FAILED  | 1        |
| Reuse        | PASSED  | 0        |
| Efficiency   | PASSED  | 0        |
| Security     | FAILED  | 2        |
```

## Phase 2b: Fix Loop

**If all 6 reviews PASSED** (or only Security FAILED — security is report-only): skip to Phase 3.

**If any review other than Security FAILED**: start a fix cycle.

### Fix Cycle

1. Collect all non-security findings and pass to a coding subagent:

```
Task(subagent_type="coding", prompt="
Fix the following review findings in Claude PowerTerminal.
Change ONLY what is necessary to address the findings.

### Architecture Findings
<findings table or 'None'>

### Quality Findings
<findings table or 'None'>

### Testing Findings
<findings table or 'None'>

### Reuse Findings
<findings table or 'None'>

### Efficiency Findings
<findings table or 'None'>

NOTE: Security findings are NOT auto-fixed — only the above categories.

After fixing, run: npm test
Report changed files and test results.
")
```

2. Restart all 6 review agents in parallel (fresh subagents, same prompts as Step 2.2).

3. Check results:
   - All PASSED → Phase 3
   - Still FAILED → compare with previous round

### Deadlock Detection

If two consecutive rounds produce >80% identical findings (same file + same description):

- Escalate — the coding agent cannot resolve these autonomously
- Include in Phase 3 report under "Open Escalations"
- Stop the fix loop

## Phase 3: Pipeline Report

Always output this structured report at the end:

```
## Pipeline Result

### Status: COMPLETE | ESCALATION | FAILED

COMPLETE   = all non-security reviews passed, tests green
ESCALATION = deadlock detected, manual intervention needed
FAILED     = tests still failing after fix attempts

### Implementation
- Feature: [short description]
- Changed files: X

### Review Results

| Review       | Status  | Findings | Auto-Fixed | Open | Rounds |
|--------------|---------|----------|------------|------|--------|
| Architecture | PASSED  | 2        | 2          | 0    | 2      |
| Quality      | PASSED  | 3        | 3          | 0    | 2      |
| Testing      | PASSED  | 1        | 1          | 0    | 2      |
| Reuse        | PASSED  | 0        | 0          | 0    | 1      |
| Efficiency   | PASSED  | 0        | 0          | 0    | 1      |
| Security     | FAILED  | 2        | -          | 2    | 1      |

### Changed Files

| File | Change |
|------|--------|
| electron/http/static-server.ts | Added endpoint X |
| src/shared/ipc-channels.ts | Added constant X |

### Tests
- Result: X passing (Y failing)

### Open Escalations
[If ESCALATION: list unresolved findings + reason coding agent could not fix]
[If COMPLETE: None]

### Security Findings (manual review required)
[List all security findings — these are NEVER auto-fixed]
```

## Important Rules

- **Phase 2 uses dedicated review subagents**: never self-review in this agent's own context.
- **All 6 reviews run in parallel**: start them in one message, not sequentially.
- **Security findings are NEVER auto-fixed**: report only, manual validation required.
- **Fresh subagent per review round**: never reuse a review agent context across rounds.
- **Only review changed lines**: instruct each review agent to analyze the diff, not the full codebase.
- **No fixed iteration limit**: loop until all pass or deadlock is detected.
- **Tests must be green** before the pipeline reports COMPLETE.
- **Never commit automatically**: the calling skill or user handles commit decisions.
