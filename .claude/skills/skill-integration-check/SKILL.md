---
name: skill-integration-check
description: Deep audit of the dual-transport architecture (IPC + HTTP + Angular) for consistency issues.
---

# Integration Check

Runs a comprehensive consistency analysis of the dual-transport architecture.

## Ablauf

1. **Spawn a general-purpose agent** using the Agent tool with `subagent_type: "general-purpose"`:

   Prompt:
   ```
   Read the file `.claude/agents/cpt-analyzer.md` for your complete analysis instructions.
   Then execute all 7 analysis steps described there against this codebase.
   Output the full structured report in the exact format specified.
   This is a read-only analysis — do not modify any files.
   ```

2. **Output the agent's report** directly to the user. No transformation needed — the agent produces the final output.

## Notes

- This skill takes no arguments.
- The analysis is read-only — no files are modified.
- Expected findings include: SESSION_GET without handler, app:lan-url without constant, hardcoded strings in log-analysis.service.ts.
