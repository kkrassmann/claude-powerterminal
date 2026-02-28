# Phase 7: Advanced Recommendations Engine - Research

**Researched:** 2026-02-28
**Domain:** JSONL parsing, anti-pattern detection, badge system, trend tracking, Angular UI
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Anti-Pattern Detection**
- Show concrete occurrences: which tool calls triggered the anti-pattern (e.g., "Turn 42: Bash grep instead of Grep tool")
- 4 base anti-patterns from roadmap: Bash-for-file-ops, Correction Loops (3+ edits same file without Read), Kitchen-Sink Sessions, Infinite Exploration (high Read:Edit ratio)
- Research may identify 2-3 additional anti-patterns beyond the base 4

**Badge System**
- Binary badges: earned or not (no progressive tiers)
- Per-session scope only — no lifetime/persistent tracking needed
- 6 base badges from roadmap (Context Master, Zero Error, Planner, Parallel Pro, Speed Demon, Researcher), research may add 2-3 more
- Visually more prominent than Phase 6 chips: small emoji/SVG icons per badge type, slightly larger, achievement-gold color for special badges

**Trend Tracking**
- Track all 5 score dimensions (Tool-Nativeness, Subagent-Nutzung, Read-before-Write, Context-Effizienz, Error-Rate) plus Anti-Pattern count per session
- Visualize with inline sparklines (pure CSS/SVG, no chart library)
- Window: last 10 sessions
- Placement: dedicated "Trends" section in the Analysis Panel (below recommendations)

**Per-Session Analysis View**
- Click on score/badge area in tile-header opens a session detail panel
- Detail view shows: score breakdown (all 5 dimensions with sub-scores), detected anti-patterns with concrete occurrences, and session-specific recommendations grouped by category
- This replaces/enhances the current aggregated-only analysis — each session becomes individually explorable

**Recommendation Presentation**
- Standalone explanations — no external doc links, each tip is self-contained and actionable
- Tone: direct and factual ("Use Grep instead of Bash grep — faster and shows results in UI")
- Grouped by category: Anti-Patterns (red) first, then Warnings (orange), Tips (blue), Praise (green), Achievements (gold)
- 5 recommendation categories total: praise, tip, warning, anti-pattern, achievement (colors per Catppuccin Mocha palette)
- Recommendations shown both in per-session detail view and in aggregated analysis panel

### Claude's Discretion
- Anti-pattern threshold values (how many occurrences trigger detection)
- Anti-pattern UI card design (inline cards vs collapsible list)
- Maximum recommendations displayed before "show more" truncation
- Exact sparkline implementation (CSS vs inline SVG)
- Badge icon choices (emoji vs custom SVG)
- Any additional anti-patterns or badges identified during research

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| OPT-04 | Expanded JSONL field extraction: turn_duration, compact_boundary events, api_error patterns, message.model, isSidechain, server_tool_use, cache_creation tiers | JSONL field mapping verified against real session files; all fields confirmed present |
| OPT-05 | Anti-pattern detection with concrete occurrence tracking, badge system with 6+ badges, per-session analysis detail view | Detection patterns designed from real tool_use sequences; badge criteria defined; IPC/HTTP routing pattern established |
| OPT-06 | Research-backed recommendations, categorized UI (5 categories), session-over-session trend tracking with sparklines | Trend data strategy from JSONL-based session list; sparkline approach via inline SVG; category mapping confirmed |
</phase_requirements>

---

## Summary

Phase 7 is a pure enhancement of the Phase 6 analysis engine — same data sources (JSONL files, stats-cache.json, history.jsonl), same streaming-readline approach, same IPC/HTTP transport layer. The work falls into three distinct layers: (1) backend parser extension with new JSONL field extraction and anti-pattern detection logic, (2) new shared types extending the existing `analysis-types.ts`, and (3) Angular UI additions: per-session detail panel, badge component, trends sparkline section.

The most critical finding is that **stats-cache.json has a completely different structure from what Phase 6 assumed**. Phase 6 `readStatsCache()` expected `Array<{model?, totalInputTokens?}>` — but the actual file is a versioned object `{version:2, dailyActivity:[{date, messageCount, sessionCount, toolCallCount}], dailyModelTokens, modelUsage:{model-name:{inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens}}}`. This matters for model-usage stats but the existing scoring engine bypasses stats-cache — it reads tokens directly from JSONL — so Phase 6 scoring still works correctly. Phase 7 can leverage `modelUsage` for the model-usage dimension without relying on the broken readStatsCache().

The trend tracking requirement (last 10 sessions, all 5 score dimensions + anti-pattern count) needs a persistence layer that doesn't exist yet. The cleanest approach is a `score-history.json` file in `userData` (same location as session storage), written after each `computeSessionScore()` call and capped at the 50 most recent session entries. The Analysis Panel reads this file to render sparklines.

**Primary recommendation:** Extend the existing backend in three surgically focused areas (parser, scoring, trend cache), add two new IPC channels, extend `analysis-types.ts`, and build the UI in two new Angular components (session-detail panel, trends section). No new npm packages needed.

---

## Standard Stack

### Core (all already installed — zero new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Angular 17 | ^17.3.0 | UI framework | Already in use |
| TypeScript 5.4 | ~5.4.2 | Type safety for shared types | Already in use |
| Node.js `readline` | built-in | Streaming JSONL parser | Already used in log-analyzer.ts |
| Node.js `fs` | built-in | File I/O (score history JSON) | Already used |
| `rxjs` | ~7.8.0 | Angular observables for panel state | Already used |

### Supporting (no new installs needed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Angular `CommonModule` | 17.x | `*ngIf`, `*ngFor` in standalone components | All new Angular components |
| Electron `ipcMain` | existing | New IPC channels for session detail | Pattern already established |
| Node.js `path`, `os` | built-in | File path construction for score history | Already imported |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline SVG sparklines | chart.js, recharts | Chart libs add 50-200KB; SVG path is ~20 lines of TS, zero bundle impact |
| File-based score history | IndexedDB / SQLite | Both are overkill; JSON file at userData path is simple, durable, already patterned |
| Emoji badge icons | Custom SVG icons | Custom SVG is more polished but adds 5-10 SVG strings per badge; emoji is zero effort, universally supported |

**Installation:**
```bash
# No new packages required
```

---

## Architecture Patterns

### Recommended Project Structure (additions only)

```
electron/analysis/
├── log-analyzer.ts          # EXTEND: new field extraction, anti-pattern detection, trend cache
├── score-history.ts         # NEW: persist and read per-session score history
└── log-analyzer.test.ts     # EXTEND: tests for new fields and anti-pattern logic

src/shared/
└── analysis-types.ts        # EXTEND: AntiPatternOccurrence, SessionScoreDetail, Trend types

src/shared/
└── ipc-channels.ts          # EXTEND: add LOG_SESSION_DETAIL, LOG_SCORE_TRENDS channels

src/src/app/
├── services/
│   └── log-analysis.service.ts   # EXTEND: loadSessionDetail(), loadTrends() methods
├── components/
│   ├── analysis-panel/
│   │   ├── analysis-panel.component.ts   # EXTEND: add Trends section
│   │   ├── analysis-panel.component.html  # EXTEND: Trends section with sparklines
│   │   └── analysis-panel.component.css   # EXTEND: sparkline styles
│   ├── session-detail/
│   │   ├── session-detail.component.ts   # NEW: per-session drill-down panel
│   │   ├── session-detail.component.html  # NEW: score breakdown, anti-patterns, recs
│   │   └── session-detail.component.css   # NEW: styling
│   └── tile-header/
│       ├── tile-header.component.ts   # EXTEND: (click) on score emits sessionSelected
│       ├── tile-header.component.html  # EXTEND: badge icons, clickable score
│       └── tile-header.component.css   # EXTEND: badge icon styles, gold color
```

### Pattern 1: Streaming JSONL Parser Extension

**What:** Extend `parseJsonlFile()` to extract new fields in a single pass without extra passes over the file.
**When to use:** All new field extractions (turn_duration, compact_boundary, model, isSidechain).
**Example:**
```typescript
// Extending ParsedStats accumulator — add new fields
interface ParsedStats {
  // ... existing fields ...
  turnDurations: number[];          // ms per turn, for avg/max computation
  compactBoundaryCount: number;     // how many auto-compacts occurred
  compactTriggers: string[];        // 'auto' | 'manual' for each boundary
  modelUsed: string | null;         // last seen message.model value
  sidechainMessages: number;        // isSidechain=true message count
  toolCallSequence: ToolCallEvent[]; // ordered list for anti-pattern detection
}

interface ToolCallEvent {
  turnIndex: number;
  toolName: string;
  targetFile?: string;    // Read/Write/Edit input.file_path
  bashCommand?: string;   // Bash input.command
  isError: boolean;
}

// In parseJsonlFile() line handler — add to assistant block extraction:
if (parsed.type === 'system' && parsed.subtype === 'turn_duration') {
  stats.turnDurations.push(parsed.durationMs);
}
if (parsed.type === 'system' && parsed.subtype === 'compact_boundary') {
  stats.compactBoundaryCount++;
  stats.compactTriggers.push(parsed.compactMetadata?.trigger ?? 'unknown');
}
if (parsed.type === 'assistant' && parsed.message?.model) {
  stats.modelUsed = parsed.message.model;
}
if ((parsed.type === 'assistant' || parsed.type === 'user') && parsed.isSidechain) {
  stats.sidechainMessages++;
}
```

### Pattern 2: Anti-Pattern Detection Engine

**What:** After accumulating `toolCallSequence`, run detection rules against the ordered list.
**When to use:** Called once at the end of `computeSessionScore()` after full parse.
**Example:**
```typescript
interface AntiPatternOccurrence {
  readonly pattern: 'bash-for-file-ops' | 'correction-loop' | 'kitchen-sink' | 'infinite-exploration';
  readonly turn: number;
  readonly detail: string;  // e.g. "Bash grep instead of Grep tool"
}

function detectAntiPatterns(
  sequence: ToolCallEvent[],
  stats: ParsedStats
): AntiPatternOccurrence[] {
  const occurrences: AntiPatternOccurrence[] = [];

  // 1. Bash-for-file-ops: Bash command contains grep/find/cat/head/tail/rg/sed/awk
  const bashFileOpsPattern = /\b(grep|find\s|rg\s|cat\s|head\s|tail\s|sed\s|awk\s)/i;
  for (const event of sequence) {
    if (event.toolName === 'Bash' && event.bashCommand &&
        bashFileOpsPattern.test(event.bashCommand)) {
      occurrences.push({
        pattern: 'bash-for-file-ops',
        turn: event.turnIndex,
        detail: `Bash file-op: "${event.bashCommand.slice(0, 60)}..."`,
      });
    }
  }

  // 2. Correction loops: 3+ Edit calls on same file without intervening Read
  // Group Edit/Write events by target file, detect gaps without Read
  const fileEditHistory: Record<string, { editCount: number; lastReadTurn: number }> = {};
  for (const event of sequence) {
    if ((event.toolName === 'Edit' || event.toolName === 'Write') && event.targetFile) {
      const h = fileEditHistory[event.targetFile] ?? { editCount: 0, lastReadTurn: -1 };
      h.editCount++;
      fileEditHistory[event.targetFile] = h;
      if (h.editCount >= 3 && event.turnIndex - h.lastReadTurn > 3) {
        occurrences.push({
          pattern: 'correction-loop',
          turn: event.turnIndex,
          detail: `${h.editCount} edits on ${event.targetFile} without Read`,
        });
        h.editCount = 0; // Reset to avoid duplicate reporting
      }
    }
    if (event.toolName === 'Read' && event.targetFile) {
      if (fileEditHistory[event.targetFile]) {
        fileEditHistory[event.targetFile].lastReadTurn = event.turnIndex;
        fileEditHistory[event.targetFile].editCount = 0;
      }
    }
  }

  // 3. Kitchen-sink: session with > 200 tool calls AND > 5 different tool types
  // AND session covers more than 3 unrelated file directories
  if (stats.totalToolCalls > 200 && stats.toolCounts.size > 5) {
    occurrences.push({
      pattern: 'kitchen-sink',
      turn: 0,
      detail: `${stats.totalToolCalls} tool calls across ${stats.toolCounts.size} tool types`,
    });
  }

  // 4. Infinite exploration: Read:Edit ratio > 10:1 with > 50 reads
  const readCount = stats.toolCounts.get('Read') || 0;
  const editCount = (stats.toolCounts.get('Edit') || 0) + (stats.toolCounts.get('Write') || 0);
  if (readCount > 50 && editCount > 0 && readCount / editCount > 10) {
    occurrences.push({
      pattern: 'infinite-exploration',
      turn: 0,
      detail: `Read:Edit ratio ${readCount}:${editCount} — too much exploration, too little output`,
    });
  }

  return occurrences;
}
```

### Pattern 3: Score History Persistence

**What:** Write per-session scores to a bounded JSON file in userData for trend tracking.
**When to use:** After every `computeSessionScore()` completion in score-history.ts.
**Example:**
```typescript
// electron/analysis/score-history.ts
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

interface HistoryEntry {
  sessionId: string;
  timestamp: string;
  score: number;
  toolNativeness: number;
  subagentScore: number;
  readBeforeWrite: number;
  contextEfficiency: number;
  errorScore: number;
  antiPatternCount: number;
}

const HISTORY_FILE = path.join(app.getPath('userData'), 'score-history.json');
const MAX_ENTRIES = 50;

export function appendScoreHistory(entry: HistoryEntry): void {
  let history: HistoryEntry[] = readScoreHistory();
  // Remove duplicate for same session (re-analysis)
  history = history.filter(h => h.sessionId !== entry.sessionId);
  history.push(entry);
  // Cap at MAX_ENTRIES (keep most recent)
  if (history.length > MAX_ENTRIES) {
    history = history.slice(history.length - MAX_ENTRIES);
  }
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
  } catch { /* silent fail */ }
}

export function readScoreHistory(): HistoryEntry[] {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  } catch { return []; }
}

export function getTrends(lastN = 10): HistoryEntry[] {
  const history = readScoreHistory();
  return history.slice(-lastN);
}
```

### Pattern 4: Inline SVG Sparklines

**What:** Render a small line chart (60x20px) as inline `<svg>` for each score dimension.
**When to use:** Trends section of the Analysis Panel.
**Example:**
```typescript
// In Angular component — pure function, no external library
buildSparklinePath(values: number[], width = 60, height = 20): string {
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const xStep = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * xStep;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `M${points.join(' L')}`;
}
```
```html
<!-- In template — no external SVG library needed -->
<svg class="sparkline" width="60" height="20" viewBox="0 0 60 20">
  <path [attr.d]="buildSparklinePath(trend.toolNativenessValues)"
        stroke="#89b4fa" stroke-width="1.5" fill="none"/>
</svg>
```

### Pattern 5: Per-Session Detail Panel (Overlay)

**What:** A sliding overlay panel opened by clicking the score in tile-header.
**When to use:** User clicks score chip in tile header to inspect session.
**Example:**
```typescript
// app.component.ts — centralized panel state
selectedSessionId: string | null = null;

onSessionSelected(sessionId: string): void {
  this.selectedSessionId = sessionId === this.selectedSessionId ? null : sessionId;
}
```
```html
<!-- app.component.html -->
<app-session-detail
  *ngIf="selectedSessionId"
  [sessionId]="selectedSessionId"
  (close)="selectedSessionId = null">
</app-session-detail>
```

### Pattern 6: Badge Icons

Emoji is the recommended approach (zero dependencies, universal support, achieves "distinct from Catppuccin" goal):

| Badge | Emoji | Trigger |
|-------|-------|---------|
| Context Master | 🧠 | cacheHitRatio > 85% |
| Zero Error | ✅ | errorRate = 0% |
| Planner | 📋 | /plan or /EnterPlanMode used |
| Parallel Pro | ⚡ | Task tool > 15% |
| Speed Demon | 🚀 | avg turn_duration < 30s |
| Researcher | 🔍 | readPct > 25% AND readCount > 20 |
| Tool Native | 🛠️ | bashCount = 0 OR nativeRatio > 0.9 (existing badge) |
| Subagent Pro | 🤝 | taskPct > 15% (existing badge) |

Achievement-gold color: `#f6c90e` (distinct from Catppuccin Mocha gold `#f9e2af`)

### Anti-Patterns to Avoid

- **Loading entire history into RAM for trend computation:** Use `getTrends(10)` which returns only the last 10 entries from the bounded file — never reads all 50
- **Rebuilding sparkline on every Angular change detection cycle:** Compute sparkline paths once in `ngOnInit()` and cache as string arrays; sparklines are static until data changes
- **Blocking IPC on score-history file write:** Use `fs.writeFileSync` (small file, <5KB) — async overkill, sync is fast enough
- **Anti-pattern detection on aggregated stats (impossible for correction loops):** Detection MUST use the ordered `toolCallSequence` array, not just counts

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Chart rendering | Custom canvas chart | Inline SVG path (4 lines of TS) | 40-line solution vs 400-line canvas renderer |
| Data persistence | Custom binary format | JSON file with `fs.writeFileSync` | Already used for sessions; simple, debuggable |
| Anti-pattern reporting format | Custom diff-like format | Simple `{pattern, turn, detail: string}` | Matches existing `Problem` interface shape |
| Badge tooltip text | Custom tooltip component | HTML `title` attribute | Zero deps, works everywhere |

**Key insight:** Everything in this phase is algorithmic logic over already-parsed data. No new data transport, no new frameworks — pure domain logic additions.

---

## Common Pitfalls

### Pitfall 1: stats-cache.json Structure Mismatch

**What goes wrong:** Phase 6 `readStatsCache()` expects an array but the actual file is an object with `version`, `dailyActivity`, `modelUsage`, etc.
**Why it happens:** The Phase 6 plan described a hypothetical schema; the real file has a more complex structure.
**How to avoid:** Phase 7 should update `readStatsCache()` to parse the real structure. Key fields: `data.modelUsage` (token totals by model), `data.dailyActivity` (daily message/session counts), `data.totalSessions`. The existing scoring engine is unaffected because it reads tokens from JSONL directly.
**Warning signs:** `readStatsCache()` returns empty array even when `~/.claude/stats-cache.json` exists.

### Pitfall 2: tool_call_sequence Memory Size

**What goes wrong:** A 20,000-line JSONL file can generate tens of thousands of ToolCallEvent objects, using significant RAM.
**Why it happens:** Unlike stats aggregation (O(1) space), storing the full sequence is O(n).
**How to avoid:** Cap the sequence at 2,000 events (matching the scoring engine's quality needs). Anti-patterns beyond that are edge cases. Alternatively, only store events needed for specific anti-patterns (Bash commands + Edit/Write/Read file paths) rather than all tool calls.
**Warning signs:** High memory usage during analysis of large sessions.

### Pitfall 3: Bash Input Command Extraction

**What goes wrong:** The `command` field is inside `block.input.command` of tool_use blocks, not at the top level.
**Why it happens:** JSONL tool_use blocks have `{type:'tool_use', name:'Bash', input:{command:'...', description:'...'}}`
**How to avoid:** Extract as `block.input?.command` during JSONL parsing. Verify `block.name === 'Bash'` first.
**Warning signs:** Anti-pattern detection never fires even for obvious Bash grep commands.

### Pitfall 4: Correction Loop Detection False Positives

**What goes wrong:** Multiple edits to the same file in a legitimate refactoring sequence get flagged as correction loops.
**Why it happens:** The naive "3 edits without Read" rule fires on valid multi-step refactors.
**How to avoid:** Threshold should be 3+ edits AND a gap of more than 3 turns since last Read. Also consider: if the edits are non-consecutive (with other tool calls in between), it's less likely a correction loop. Start conservative: minimum 4 edits, cross-session threshold is user discretion.
**Warning signs:** High number of correction-loop false positives in legitimate coding sessions.

### Pitfall 5: Sparkline Rendering on Empty/Single Data Point

**What goes wrong:** SVG path is invalid when values array has 0 or 1 element.
**Why it happens:** `buildSparklinePath()` tries to compute a line between 0 or 1 points.
**How to avoid:** Guard: `if (values.length < 2) return ''`. Render sparkline only when `trends.length >= 2` in template.
**Warning signs:** Angular template throws error or SVG renders broken path.

### Pitfall 6: Per-Session Detail IPC Call Duplication

**What goes wrong:** Opening a session detail panel triggers a full JSONL re-parse even if score was just computed.
**Why it happens:** `computeSessionScore()` and `computeSessionDetail()` parse the same file independently.
**How to avoid:** `computeSessionScore()` should return an extended `SessionScoreDetail` that includes anti-pattern occurrences and sub-scores. One parse, one result. Cache this enriched result with the same 5-minute TTL as the aggregated analysis — keyed by sessionId.
**Warning signs:** Opening a session detail panel takes 3+ seconds even for recently analyzed sessions.

### Pitfall 7: Angular Change Detection on sessionScores Map

**What goes wrong:** Updating a Map value doesn't trigger Angular change detection, so the tile-header doesn't re-render.
**Why it happens:** Angular's default change detection compares references; mutating Map internals doesn't change the Map reference.
**How to avoid:** Already solved in Phase 6 dashboard: `this.sessionScores = new Map(this.sessionScores)` after updating. Phase 7 must maintain this pattern when adding anti-pattern counts to the score result.
**Warning signs:** Badge/score updates don't appear until next user interaction.

---

## Code Examples

Verified patterns from the actual codebase:

### Real JSONL Record Types and Fields

```typescript
// Confirmed from real ~/.claude/projects/*/*.jsonl files (2026-02-28)

// type='user' top-level keys:
// parentUuid, isSidechain, userType, cwd, sessionId, version, gitBranch, slug,
// type, message, uuid, timestamp, sourceToolAssistantUUID, toolUseResult,
// isCompactSummary, planContent, thinkingMetadata, permissionMode, isVisibleInTranscriptOnly

// type='assistant' top-level keys:
// parentUuid, isSidechain, userType, cwd, sessionId, version, gitBranch, slug,
// message, requestId, type, uuid, timestamp

// type='system' subtypes observed in real files:
// 'turn_duration' → { durationMs: number }
// 'compact_boundary' → { compactMetadata: { trigger: 'auto'|'manual', preTokens: number } }
// 'stop_hook_summary' → { hookCount: number, hookInfos: [...] }

// assistant message.content tool_use block:
// { type: 'tool_use', id: string, name: string, input: { command?, file_path?, ... } }

// user message.content tool_result block:
// { type: 'tool_result', tool_use_id: string, content: string, is_error: boolean }

// Bash tool input shape: { command: string, description?: string, timeout?: number }
// Read tool input shape: { file_path: string, offset?: number, limit?: number }
// Edit tool input shape: { file_path: string, old_string: string, new_string: string }
// Write tool input shape: { file_path: string, content: string }
```

### stats-cache.json Real Structure

```typescript
// Actual structure of ~/.claude/stats-cache.json (verified 2026-02-28)
interface StatsCacheFile {
  version: 2;
  lastComputedDate: string;          // 'YYYY-MM-DD'
  dailyActivity: Array<{
    date: string;
    messageCount: number;
    sessionCount: number;
    toolCallCount: number;
  }>;
  dailyModelTokens: Array<{
    date: string;
    tokensByModel: Record<string, number>;
  }>;
  modelUsage: Record<string, {        // key = model name e.g. 'claude-opus-4-6'
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    webSearchRequests: number;
    costUSD: number;
  }>;
  totalSessions: number;
  totalMessages: number;
  longestSession: { sessionId: string; duration: number; messageCount: number; timestamp: string };
  firstSessionDate: string;
  hourCounts: Record<string, number>;
  totalSpeculationTimeSavedMs: number;
}
```

### Extended Shared Types

```typescript
// Additions to src/shared/analysis-types.ts

/** Anti-pattern occurrence with concrete turn reference */
export interface AntiPatternOccurrence {
  readonly pattern: 'bash-for-file-ops' | 'correction-loop' | 'kitchen-sink' | 'infinite-exploration';
  readonly turn: number;
  readonly detail: string;
}

/** New 5-category recommendation severity */
// CHANGE: 'info' -> 'tip', add 'anti-pattern', 'achievement'
export interface Recommendation {
  readonly severity: 'praise' | 'tip' | 'warning' | 'anti-pattern' | 'achievement';
  readonly title: string;
  readonly description: string;
  readonly metric?: string;
}

/** Score breakdown for per-session detail view */
export interface SessionScoreDetail extends SessionPracticeScore {
  readonly toolNativenessScore: number;   // 0-100
  readonly subagentScore: number;         // 0-100
  readonly readBeforeWriteScore: number;  // 0-100
  readonly contextEfficiencyScore: number; // 0-100
  readonly errorScore: number;            // 0-100
  readonly antiPatterns: AntiPatternOccurrence[];
  readonly recommendations: Recommendation[];
  readonly avgTurnDurationMs: number;
  readonly compactBoundaryCount: number;
  readonly modelUsed: string | null;
}

/** Single entry in the score history for trend tracking */
export interface ScoreHistoryEntry {
  readonly sessionId: string;
  readonly timestamp: string;
  readonly score: number;
  readonly toolNativenessScore: number;
  readonly subagentScore: number;
  readonly readBeforeWriteScore: number;
  readonly contextEfficiencyScore: number;
  readonly errorScore: number;
  readonly antiPatternCount: number;
}

/** Trend data for the sparkline section */
export interface ScoreTrends {
  readonly entries: ScoreHistoryEntry[];   // last N sessions
  readonly totalScore: number[];           // for sparkline
  readonly toolNativeness: number[];
  readonly subagent: number[];
  readonly readBeforeWrite: number[];
  readonly contextEfficiency: number[];
  readonly errorScore: number[];
  readonly antiPatternCount: number[];
}
```

### Catppuccin Mocha Category Colors

```css
/* 5-category recommendation colors from Catppuccin Mocha palette */
.severity-praise      { border-left-color: #a6e3a1; }  /* green */
.severity-tip         { border-left-color: #89b4fa; }  /* blue */
.severity-warning     { border-left-color: #fab387; }  /* peach/orange */
.severity-anti-pattern { border-left-color: #f38ba8; } /* red */
.severity-achievement { border-left-color: #f6c90e; }  /* achievement gold (distinct from palette) */
```

---

## State of the Art

| Old Approach (Phase 6) | Current Approach (Phase 7) | Impact |
|------------------------|---------------------------|--------|
| `'info'` severity level | `'tip'` severity level | Rename to match 5-category spec; requires update to analysis-types.ts and all rule generators |
| Flat recommendation list | Sorted by severity: anti-pattern → warning → tip → praise → achievement | Frontend sorts or backend sorts before returning |
| Per-session score has `badges: string[]` (text labels) | Badges include emoji icons + achievement-gold color | Badge chips upgrade: add emoji prefix, gold color for achievement badges |
| No anti-pattern detection | Turn-indexed anti-pattern occurrences with specific tool call details | New detection layer after parse |
| No trend tracking | Last 10 sessions tracked, sparklines in panel | New score-history.ts + ScoreTrends type + Trends section in panel |
| No per-session detail view | Click score → sliding detail panel with all 5 sub-scores + anti-patterns | New SessionDetailComponent + IPC channel |
| `readStatsCache()` returns empty (wrong schema) | Updated to parse real stats-cache.json v2 schema | Token stats from stats-cache now actually work |

**Deprecated/outdated:**
- `Recommendation.severity: 'info'`: Renamed to `'tip'` to match the 5-category system. All existing `'info'` rules must be updated to `'tip'`.

---

## Open Questions

1. **Cache-clearing strategy for session detail cache**
   - What we know: `computeSessionScore()` has no per-session cache; `analyzeAllSessions()` has a 5-min TTL
   - What's unclear: Should `computeSessionDetail()` share the same 5-min cache or use a separate Map keyed by sessionId?
   - Recommendation: Use a `Map<string, {result: SessionScoreDetail, cachedAt: number}>` with 5-min TTL per session. This avoids re-parsing when the user opens detail for multiple sessions in sequence.

2. **How to handle isSidechain=true records in the tool call sequence**
   - What we know: `isSidechain` field exists on both `user` and `assistant` records; appears to mark sub-agent tool calls
   - What's unclear: Should sidechain tool calls be excluded from anti-pattern detection (since Claude spawned them, not the user driving them)?
   - Recommendation: Keep sidechain tool calls in the sequence for anti-pattern detection but track `sidechainMessages` count separately. This gives a future badge ("Subagent Delegator") if sidechain use is high.

3. **Score-history.json location in test environments**
   - What we know: `app.getPath('userData')` works only in Electron process
   - What's unclear: Tests that import score-history.ts will fail because `app` is not available
   - Recommendation: Accept `userDataPath` as optional parameter in `score-history.ts` with a default that uses `app.getPath('userData')`. Tests pass a temp directory.

---

## Sources

### Primary (HIGH confidence)
- Direct inspection of `~/.claude/projects/C--Dev-api/18884f1e-*.jsonl` (2026-02-28) — All JSONL field names and record types
- Direct inspection of `~/.claude/stats-cache.json` (2026-02-28) — Real stats-cache v2 schema
- Phase 6 implementation files: `electron/analysis/log-analyzer.ts`, `src/shared/analysis-types.ts`, `src/src/app/components/analysis-panel/`, `src/src/app/components/tile-header/` — Current code structure

### Secondary (MEDIUM confidence)
- Phase 6 PLAN files (06-01-PLAN.md, 06-02-PLAN.md) — Established architectural patterns for IPC/HTTP dual-mode, BehaviorSubject service pattern, scoring weights

### Tertiary (LOW confidence)
- Anti-pattern threshold values (3 edits, 200 tool calls, 10:1 read:edit ratio) — Reasonable starting values based on Claude CLI usage patterns; should be tuned with real user feedback after deployment

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — No new libraries; all existing patterns confirmed in codebase
- Architecture: HIGH — Direct codebase inspection; IPC pattern, streaming parser, Angular service pattern all verified
- JSONL field mapping: HIGH — Verified from real session files on developer's machine
- stats-cache.json schema: HIGH — Verified from real file; Phase 6 schema assumption was wrong
- Anti-pattern thresholds: LOW — Reasonable guesses; require empirical tuning
- Pitfalls: HIGH — Most come from direct code inspection and observed schema mismatches

**Research date:** 2026-02-28
**Valid until:** 2026-04-01 (stable — Claude CLI JSONL format changes infrequently)
