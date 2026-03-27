---
name: skill-implement
description: Full implementation pipeline - spawns cpt-implement-pipeline agent that codes, runs 6 parallel reviews (architecture, quality, tests, reuse, efficiency, security), auto-fixes issues, and offers commit when all checks pass.
argument-hint: [task-description]
allowed-tools: Bash, Read, Task, AskUserQuestion
---

# Implement Pipeline Skill

Thin wrapper that starts the `cpt-implement-pipeline` agent. The agent autonomously handles coding + 6x review (Architecture, Quality, Tests, Reuse, Efficiency, Security) + auto-fix. This skill surfaces the result and handles commit/escalation.

## Input

Task / feature description: $ARGUMENTS

## Workflow

### Step 1: Start pipeline agent

```
Task(subagent_type="cpt-implement-pipeline", prompt="Implement the following feature/task:

$ARGUMENTS")
```

### Step 2: Evaluate pipeline report

The agent returns a structured report with status, review results, and changed files.

**Status DONE** (all reviews passed):

Show the report and ask:

```
AskUserQuestion:
- "Commit" — Create the commit
- "Show changes" — Show git diff for manual review
- "Cancel" — No commit, changes stay unstaged
```

**Status ESCALATION** (unresolved findings):

Show the open findings and ask:

```
AskUserQuestion:
- "Retry" — Another fix attempt via pipeline agent
- "Ignore and commit" — Accept findings as-is
- "Cancel" — Stop pipeline
```

**Status FAILED**:

Show the error and all previous attempts. Offer:
- Manual debugging
- Re-run coding agent with additional context
- Run `/skill-preflight` to identify root cause

### Step 3: Commit (if requested)

On **"Commit"**:
1. `git add <all changed files>` (specific files, NOT `git add .`)
2. Create commit with descriptive message
3. Show `git status` to confirm

On **"Show changes"**:
1. Show `git diff` output
2. Ask again for commit decision

## Verification Gate

Before marking as done the pipeline agent must confirm:
- `npm run build` exits 0 (TypeScript compilation clean)
- `npx vitest run` exits 0 (no regressions)

If either fails, the agent must fix before returning DONE status.

## Important Rules

- **Commit only with user approval** — never auto-commit
- **Specific git add** — never `git add .` or `git add -A`
- **Use /skill-preflight** for pre-commit validation if in doubt
- The agent runs autonomously — the skill waits for its result
