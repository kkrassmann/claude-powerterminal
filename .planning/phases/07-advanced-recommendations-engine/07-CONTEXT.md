# Phase 7: Advanced Recommendations Engine - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Upgrade the existing session log analysis engine (Phase 6) with expanded JSONL field extraction, anti-pattern detection, research-backed recommendations, a new badge system, session-over-session trend tracking, and an enhanced recommendation UI with categorized tips. No new data sources — reads the same Claude CLI JSONL logs, stats-cache.json, and history.jsonl.

</domain>

<decisions>
## Implementation Decisions

### Anti-Pattern Detection
- Show concrete occurrences: which tool calls triggered the anti-pattern (e.g., "Turn 42: Bash grep instead of Grep tool")
- 4 base anti-patterns from roadmap: Bash-for-file-ops, Correction Loops (3+ edits same file without Read), Kitchen-Sink Sessions, Infinite Exploration (high Read:Edit ratio)
- Research may identify 2-3 additional anti-patterns beyond the base 4

### Badge System
- Binary badges: earned or not (no progressive tiers)
- Per-session scope only — no lifetime/persistent tracking needed
- 6 base badges from roadmap (Context Master, Zero Error, Planner, Parallel Pro, Speed Demon, Researcher), research may add 2-3 more
- Visually more prominent than Phase 6 chips: small emoji/SVG icons per badge type, slightly larger, achievement-gold color for special badges

### Trend Tracking
- Track all 5 score dimensions (Tool-Nativeness, Subagent-Nutzung, Read-before-Write, Context-Effizienz, Error-Rate) plus Anti-Pattern count per session
- Visualize with inline sparklines (pure CSS/SVG, no chart library)
- Window: last 10 sessions
- Placement: dedicated "Trends" section in the Analysis Panel (below recommendations)

### Recommendation Presentation
- Standalone explanations — no external doc links, each tip is self-contained and actionable
- Tone: direct and factual ("Use Grep instead of Bash grep — faster and shows results in UI")
- Grouped by category: Anti-Patterns (red) first, then Warnings (orange), Tips (blue), Praise (green), Achievements (gold)
- 5 recommendation categories total: praise, tip, warning, anti-pattern, achievement (colors per Catppuccin Mocha palette)

### Claude's Discretion
- Anti-pattern threshold values (how many occurrences trigger detection)
- Anti-pattern UI card design (inline cards vs collapsible list)
- Maximum recommendations displayed before "show more" truncation
- Exact sparkline implementation (CSS vs inline SVG)
- Badge icon choices (emoji vs custom SVG)
- Any additional anti-patterns or badges identified during research

</decisions>

<specifics>
## Specific Ideas

- Anti-pattern detail should show the specific tool call that triggered it — learning effect is key
- Sparklines should be compact enough to sit next to metric labels without disrupting layout
- Achievement-gold badges should feel distinct from the regular Catppuccin color palette
- Recommendation tone should be like a senior developer reviewing code: factual, no fluff, actionable

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-advanced-recommendations-engine*
*Context gathered: 2026-02-28*
