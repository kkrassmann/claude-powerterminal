---
name: skill-preflight
description: Pre-commit validation — runs TypeScript build, Vitest tests, and dual-transport consistency check in parallel.
---

# Preflight Check

Validates the project before committing: TypeScript compilation, test suite, and architectural consistency.

## Ablauf

1. **Run three checks in parallel** (multiple tool calls in one message):

   a. **TypeScript Build** via Bash:
      ```bash
      npm run build:electron
      ```

   b. **Vitest Tests** via Bash:
      ```bash
      npm test
      ```

   c. **Consistency Analysis** via Agent tool with `subagent_type: "general-purpose"`:
      Prompt:
      ```
      Read the file `.claude/agents/cpt-analyzer.md` for your complete analysis instructions.
      Then execute all 7 analysis steps described there against this codebase.
      Output the full structured report in the exact format specified.
      This is a read-only analysis — do not modify any files.
      ```

   Launch all three in parallel. Build and tests are independent Bash calls, the agent runs concurrently.

2. **Collect results** from all three. Classify each as PASS, FAIL, or WARN:
   - **TypeScript Build**: PASS if exit code 0, FAIL otherwise
   - **Vitest Tests**: PASS if exit code 0, FAIL otherwise. Extract pass/fail counts from output.
   - **Consistency Analysis**: WARN if orphaned handlers or hardcoded strings found, PASS if clean

3. **Output combined report** in this format:

```
PREFLIGHT RESULTS
=================
[PASS] TypeScript build
[PASS] Vitest (X passed)
[WARN] SESSION_GET: Constant defined, no handler registered
[WARN] app:lan-url: Handler without IPC_CHANNELS constant
[WARN] Hardcoded channel strings in log-analysis.service.ts (lines 110, 131)
[INFO] X warnings, 0 errors
```

If any check FAILs, clearly mark it and show the error output.

## Notes

- This skill takes no arguments.
- If the build fails, still wait for the other checks to complete — report all results together.
- The consistency warnings are informational — they don't block a commit but should be addressed.
