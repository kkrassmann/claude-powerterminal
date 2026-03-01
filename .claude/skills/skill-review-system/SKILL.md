---
name: skill-review-system
description: Multi-agent system review — spawns 3 specialized agents (architecture, quality, testing) in parallel for comprehensive codebase analysis.
---

# System Review

Runs a comprehensive multi-agent system review that analyzes architecture, code quality, and test coverage in parallel. Produces a combined report in `system-review.md`.

## Ablauf

1. **Spawn 3 review agents in parallel** (all in a single message with 3 Agent tool calls):

   a. **Architecture Agent** — `subagent_type: "general-purpose"`:
      ```
      Read the file `.claude/agents/cpt-review-architecture.md` for your complete analysis instructions.
      Then execute all 7 analysis steps described there against this codebase.
      Output the full structured report in the exact format specified.
      This is a read-only analysis — do not modify any files.
      ```

   b. **Quality Agent** — `subagent_type: "general-purpose"`:
      ```
      Read the file `.claude/agents/cpt-review-quality.md` for your complete analysis instructions.
      Then execute all 7 analysis steps described there against this codebase.
      Output the full structured report in the exact format specified.
      This is a read-only analysis — do not modify any files.
      ```

   c. **Testing Agent** — `subagent_type: "general-purpose"`:
      ```
      Read the file `.claude/agents/cpt-review-testing.md` for your complete analysis instructions.
      Then execute all 7 analysis steps described there against this codebase.
      Output the full structured report in the exact format specified.
      This is a read-only analysis — do not modify any files.
      ```

   All three MUST be launched in parallel (3 Agent tool calls in one message).

2. **Collect results** from all three agents. Each returns a structured report with findings.

3. **Deduplicate and cross-reference findings:**

   Compare all findings across agents by file path + line number + description similarity:

   a. **Exact duplicates** (same file, same line, same issue): Merge into one finding. Keep the highest severity. Add note: `Identified by: Architecture, Quality` (or whichever agents found it). Use the finding ID from the agent that found it first (alphabetical: A before Q before T).

   b. **Overlapping findings** (same root cause but different perspective): Keep both but add cross-references. Example: Architecture finds "PTY wiring duplicated 4x" and Quality finds "PTY registration copy-pasted 4x" → add `See also: Q-004` to the architecture finding and `See also: A-014` to the quality finding.

   c. **Independent findings**: Keep as-is, no annotation needed.

   Update the summary table counts to reflect deduplicated totals. Add a `Deduplicated` row showing how many were merged.

4. **Build summary table** by parsing each agent's SUMMARY section (after deduplication):

   Count findings per severity per agent:
   - Architecture: X critical, Y major, Z minor
   - Quality: X critical, Y major, Z minor
   - Testing: X critical, Y major, Z minor
   - Deduplicated: -N (merged duplicates removed from total)

5. **Write combined report** to `system-review.md` in the project root using the Write tool:

   ```markdown
   # System Review Report

   Generated: YYYY-MM-DD HH:MM

   ## Summary

   | Agent        | Critical | Major | Minor | Total |
   |--------------|----------|-------|-------|-------|
   | Architecture | X        | X     | X     | X     |
   | Quality      | X        | X     | X     | X     |
   | Testing      | X        | X     | X     | X     |
   | **Total**    | **X**    | **X** | **X** | **X** |
   | Deduplicated | -N       |       |       | -N    |
   | **Unique**   | **X**    | **X** | **X** | **X** |

   ## Deduplicated Findings

   [List merged findings with "Identified by: Agent1, Agent2" note]

   ## Architecture Review

   [Full architecture agent report — with "See also: Q-xxx" cross-refs where applicable]

   ## Code Quality Review

   [Full quality agent report — with "See also: A-xxx" cross-refs where applicable]

   ## Test Coverage Review

   [Full testing agent report — with "See also: A-xxx / Q-xxx" cross-refs where applicable]
   ```

6. **Output short summary** to the user:

   ```
   SYSTEM REVIEW COMPLETE
   ======================
   Architecture: X critical, Y major, Z minor
   Quality:      X critical, Y major, Z minor
   Testing:      X critical, Y major, Z minor
   Deduplicated: -N merged
   Unique total: X findings

   Full report written to system-review.md
   ```

## Notes

- This skill takes no arguments.
- All analysis is read-only — no source files are modified.
- The only file written is `system-review.md` in the project root.
- Each agent runs independently. If one fails, still report the results from the other two.
- Do NOT add `system-review.md` to git. It is a transient artifact meant for developer review.
