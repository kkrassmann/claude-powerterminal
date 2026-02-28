# Phase 8: Project Configuration Audit - Research

**Researched:** 2026-02-28
**Domain:** Static file heuristics engine + Angular tab UI + dual-transport (IPC/HTTP)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Audit-Trigger & Ordnerauswahl**
- Audit lebt als Sektion/Tab im bestehenden Analyse-Panel (nicht eigenes Panel)
- Projekt wird aus Dropdown bekannter Claude-Projekte gewahlt (aus ~/.claude/projects/)
- Manueller Start per Button innerhalb der Audit-Sektion, kein Auto-Run
- Ergebnisse werden gecached bis zum nachsten manuellen Trigger
- Dual-Transport: IPC fur Electron + HTTP-Endpoint fur Remote-Browser

**Ergebnisdarstellung**
- Datei-Liste mit Score pro Datei (0-100), expandierbar fur Details
- Gesamtscore prominent angezeigt + Improvement Potential als Subtext
- Detail-Ansicht pro Datei: Findings mit Severity + konkretem Fix-Vorschlag
- Severity-Farben: gleiches 5-Stufen-System wie Session-Recommendations (praise/tip/warning/anti-pattern/achievement)

**Audit-Prompt Architektur**
- Externe .md Datei im Projekt (z.B. electron/analysis/audit-prompt.md)
- Versioniert in Git, zur Laufzeit gelesen
- Strukturierte Checkliste (maschinen-parsebar): Kategorie, Regel-ID, Pattern, Severity, Fix-Text
- Lokale Heuristiken — kein LLM-API-Call, deterministisch, schnell
- Dateien werden inhaltlich gelesen und bewertet, nicht nur Metadaten

**Bewertungskriterien**
- 4 Dateitypen: CLAUDE.md, Skills, Agent Configs, MCP Server Configs
- CLAUDE.md: Struktur + Inhalt (Sektionen vorhanden, Anweisungen spezifisch, Laenge angemessen, keine Widersprueche)
- Skills: Klare Trigger, sinnvolle Beschreibungen, korrekte Syntax
- Agent Configs: Rollen klar, Tools sinnvoll eingeschrankt, Prompts praezise
- MCP Configs: Referenzierte Server konfiguriert, Konfigurationen vollstaendig
- Feste Regeln in der .md Datei, keine Plugin-Erweiterbarkeit
- Einzelbewertung pro Projekt, kein Projekt-Vergleich

**Claude's Discretion**
- Genaue Regel-IDs und Pattern-Definitionen in der Checkliste
- Gewichtung der einzelnen Kategorien fur den Gesamtscore
- Layout-Details der Audit-Sektion im Analyse-Panel
- Cache-TTL fur Audit-Ergebnisse

### Deferred Ideas (OUT OF SCOPE)
- Projekt-Vergleiche (mehrere Projekte nebeneinander bewerten)
- Custom Rules Plugin-System (User eigene Regeln ablegen)
- LLM-basierte semantische Analyse als optionale Erweiterung
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AUD-01 | Button in UI triggers analysis of a selected/current Claude project folder | Project dropdown uses ~/.claude/projects/ dir listing (same source as session analysis); IPC + HTTP dual-transport established pattern |
| AUD-02 | Results show per-file quality scores and overall improvement potential; concrete recommendations with severity; prompt lives as standalone versioned file | Heuristic engine pattern mirrors log-analyzer.ts; audit-prompt.md as external rule source parsed at runtime |
| AUD-03 | Works in both Electron app and remote browser | Established IPC + GET /api/audit/* HTTP endpoint pattern from Phases 5-7 |
</phase_requirements>

---

## Summary

Phase 8 adds a **deterministic heuristic audit engine** for Claude project configuration files. The audit reads CLAUDE.md, skill definitions (`.claude/commands/`), agent configs (`.claude/agents/`), and MCP server configs (`.claude/settings.json`) from a user-selected project directory, evaluates them against structured rules in an external `audit-prompt.md` checklist, and displays per-file scores (0-100) and concrete fix recommendations in a new tab inside the existing analysis panel.

The technical approach is a direct extension of the log-analyzer.ts pattern: a backend Node.js module in `electron/analysis/` that reads files synchronously (files are small — no streaming needed), applies rule patterns from a parsed `audit-prompt.md`, produces typed results, and exposes them via the existing IPC + HTTP dual-transport. The Angular frontend adds an "Audit" tab to the analysis panel with a project dropdown, trigger button, file list with expandable details, and severity-colored findings — all using the same patterns as the Phase 6/7 analysis panel.

The key design insight: the `audit-prompt.md` is NOT a prompt for an LLM — it is a machine-parseable rule file that the heuristic engine reads to know what patterns to check. No API call, no LLM, pure file regex/structure checks. This makes it fast (< 1 second), deterministic, and offline-capable.

**Primary recommendation:** Model the audit engine on `log-analyzer.ts` (streaming replaced by sync reads since config files are small), model the Angular UI on the existing analysis panel's section/card pattern, and use a YAML-like frontmatter block in `audit-prompt.md` to define rules in a machine-parseable format.

---

## Standard Stack

### Core (no new dependencies needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `fs` | built-in | Sync file reads for config files | Same as log-analyzer.ts; config files are small, sync is fine |
| Node.js `path` | built-in | Cross-platform path construction | Established pattern throughout codebase |
| Node.js `os` | built-in | `os.homedir()` for ~/.claude resolution | Used in `getClaudeHome()` already |
| TypeScript | 5.9.3 | Type-safe audit result interfaces | Matches project tsconfig |
| Angular 17+ | existing | Audit tab UI in analysis panel | Standalone components, CommonModule |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `electron/ipcMain` | existing | IPC handler for audit trigger | Electron app path |
| Node.js `http` static-server | existing | HTTP GET /api/audit endpoint | Remote browser path |
| Catppuccin Mocha palette | existing (CSS vars) | Severity colors in audit UI | Match existing analysis panel styling |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Sync fs.readFileSync for config files | readline streaming | Config files are < 50KB; streaming adds complexity with no benefit |
| Custom rule DSL in audit-prompt.md | JSON rule file | Markdown is human-editable without tooling; keep as .md with structured sections |
| New panel/modal | Tab in existing analysis panel | CONTEXT.md locked this: reuse existing panel |

**Installation:** No new packages needed.

---

## Architecture Patterns

### Recommended File Structure

```
electron/
└── analysis/
    ├── log-analyzer.ts          # existing Phase 6/7
    ├── score-history.ts         # existing Phase 7
    ├── audit-engine.ts          # NEW: heuristic audit engine
    └── audit-prompt.md          # NEW: versioned rule checklist

electron/ipc/
└── analysis-handlers.ts        # ADD: audit IPC handlers

electron/http/
└── static-server.ts            # ADD: GET /api/audit, GET /api/audit/projects

src/shared/
└── audit-types.ts              # NEW: shared TypeScript interfaces

src/src/app/
├── services/
│   └── audit.service.ts        # NEW: dual-transport service
└── components/
    └── analysis-panel/
        ├── analysis-panel.component.ts    # MODIFY: add audit tab state
        ├── analysis-panel.component.html  # MODIFY: add audit tab + UI
        └── analysis-panel.component.css   # MODIFY: audit-specific styles
```

### Pattern 1: Audit-Prompt.md Rule Format

The `audit-prompt.md` is parsed by the engine at runtime. Each rule is machine-readable:

```markdown
## CLAUDE.md Rules

### RULE CMD-01
**Category:** claude-md
**Severity:** warning
**Check:** section-exists
**Pattern:** ## Build
**Fix:** Add a "## Build & Run Commands" section with the main build/run commands for this project.

### RULE CMD-02
**Category:** claude-md
**Severity:** anti-pattern
**Check:** length-check
**Min:** 50
**Max:** 600
**Fix:** CLAUDE.md should be 50-600 lines. Too short = no real guidance. Too long = Claude ignores it.

### RULE CMD-03
**Category:** claude-md
**Severity:** tip
**Check:** section-exists
**Pattern:** ## Critical
**Fix:** Add a "## Critical Rules" section with the most important project conventions.
```

The engine parses this with regex (`### RULE (\w+-\d+)` headers), extracts key-value pairs from the block, and executes the check type against file content.

**Supported check types:**
- `section-exists` — regex match in file content
- `length-check` — line count within min/max
- `content-regex` — arbitrary regex on file content
- `file-exists` — check file/directory presence
- `yaml-key` — check key exists in JSON/YAML-like config

### Pattern 2: Audit Engine Structure (mirrors log-analyzer.ts)

```typescript
// Source: modeled on electron/analysis/log-analyzer.ts
export interface AuditRule {
  id: string;           // e.g., "CMD-01"
  category: 'claude-md' | 'skill' | 'agent' | 'mcp';
  severity: 'praise' | 'tip' | 'warning' | 'anti-pattern';
  check: 'section-exists' | 'length-check' | 'content-regex' | 'file-exists' | 'yaml-key';
  pattern?: string;
  min?: number;
  max?: number;
  fix: string;
}

export interface AuditFinding {
  ruleId: string;
  severity: AuditRule['severity'];
  passed: boolean;
  detail: string;
  fix: string;
}

export interface AuditFileResult {
  filePath: string;
  fileType: 'claude-md' | 'skill' | 'agent' | 'mcp';
  displayName: string;
  score: number;             // 0-100
  findings: AuditFinding[];
}

export interface ProjectAuditResult {
  projectPath: string;
  projectName: string;       // last path segment
  overallScore: number;      // 0-100 weighted average
  improvementPotential: number;  // 100 - overallScore
  files: AuditFileResult[];
  cachedAt: number;
}
```

### Pattern 3: Project Discovery

```typescript
// Mirrors discoverSessionFiles() from log-analyzer.ts
export function discoverClaudeProjects(): string[] {
  const claudeHome = path.join(os.homedir(), '.claude', 'projects');
  // Each dir in ~/.claude/projects/ is a URL-encoded project path
  // e.g., "C--Dev-api" = "C:/Dev/api"
  const dirs = fs.readdirSync(claudeHome);
  return dirs
    .map(dir => decodeProjectDir(dir))  // convert C--Dev-api → C:/Dev/api
    .filter(p => fs.existsSync(p));
}

function decodeProjectDir(encoded: string): string {
  // Claude encodes paths: replace '--' with '/' and '-' with path separator
  // Pattern: "C--Dev-api" → "C:/Dev/api" (Windows)
  // Pattern: "-home-user-project" → "/home/user/project" (Linux/Mac)
  // The actual mapping: leading '-' = Unix root, no '-' = Windows drive
  // Claude uses '--' for path separators
  return encoded
    .replace(/^([A-Z])--/, '$1:/')   // Windows: C-- → C:/
    .replace(/^-/, '/')               // Unix: leading - → /
    .replace(/--/g, '/');            // path separators
}
```

**Important:** The `~/.claude/projects/` directories are named with a specific encoding. Verify against actual project dirs on the machine. Confirmed structure from codebase inspection: `C--Dev-claude-powerterminal` maps to `C:/Dev/claude-powerterminal`.

### Pattern 4: Dual-Transport (IPC + HTTP)

**IPC handler** (in `analysis-handlers.ts`):
```typescript
// New IPC channels to add to IPC_CHANNELS constant
AUDIT_PROJECTS: 'audit:projects',
AUDIT_RUN: 'audit:run',

ipcMain.handle(IPC_CHANNELS.AUDIT_PROJECTS, async () => {
  return discoverClaudeProjects();
});

ipcMain.handle(IPC_CHANNELS.AUDIT_RUN, async (_event, projectPath: string) => {
  return runProjectAudit(projectPath);
});
```

**HTTP endpoints** (in `static-server.ts`):
```typescript
// GET /api/audit/projects
if (req.method === 'GET' && pathname === '/api/audit/projects') {
  res.writeHead(200, corsHeaders);
  res.end(JSON.stringify(discoverClaudeProjects()));
  return;
}

// GET /api/audit/run?path=<projectPath>
if (req.method === 'GET' && pathname === '/api/audit/run') {
  const projectPath = url.searchParams.get('path') ?? '';
  const result = await runProjectAudit(projectPath);
  res.writeHead(200, corsHeaders);
  res.end(JSON.stringify(result));
  return;
}
```

**Angular service** (mirrors `LogAnalysisService`):
```typescript
async loadProjects(): Promise<string[]> {
  if (window.electronAPI) {
    return window.electronAPI.invoke('audit:projects');
  }
  const resp = await fetch(`http://${window.location.hostname}:9801/api/audit/projects`);
  return resp.json();
}

async runAudit(projectPath: string): Promise<ProjectAuditResult> {
  if (window.electronAPI) {
    return window.electronAPI.invoke('audit:run', projectPath);
  }
  const resp = await fetch(
    `http://${window.location.hostname}:9801/api/audit/run?path=${encodeURIComponent(projectPath)}`
  );
  return resp.json();
}
```

### Pattern 5: Analysis Panel Tab Structure

The existing analysis panel has no tabs — it's a single scrollable view. The audit adds a second "section" at the top (not a full tab system — CONTEXT.md says "Sektion/Tab im bestehenden Analyse-Panel"). The simplest approach: add a tab switcher at the top of the panel with two buttons ("Session-Analyse" | "Projekt-Audit"), toggle the active section with `*ngIf`.

```html
<!-- Tab switcher at top of panel -->
<div class="panel-tabs">
  <button class="tab-btn" [class.active]="activeTab === 'analysis'" (click)="activeTab = 'analysis'">
    Session-Analyse
  </button>
  <button class="tab-btn" [class.active]="activeTab === 'audit'" (click)="activeTab = 'audit'">
    Projekt-Audit
  </button>
</div>

<!-- Existing analysis content -->
<div *ngIf="activeTab === 'analysis'" ...>

<!-- New audit tab content -->
<div *ngIf="activeTab === 'audit'" class="audit-section">
  <div class="audit-controls">
    <select [(ngModel)]="selectedProject">
      <option *ngFor="let p of projects" [value]="p">{{ formatProjectName(p) }}</option>
    </select>
    <button (click)="runAudit()" [disabled]="auditLoading || !selectedProject">
      {{ auditLoading ? 'Analysiere...' : 'Audit starten' }}
    </button>
  </div>
  <!-- Results: overall score, file list, expandable details -->
</div>
```

**Note:** Adding FormsModule or ReactiveFormsModule import is required for `[(ngModel)]` in standalone component.

### Anti-Patterns to Avoid

- **Streaming JSONL pattern for config files:** Config files are tiny (< 50KB). Do NOT use readline streaming — simple `fs.readFileSync` is correct and simpler.
- **LLM API call:** CONTEXT.md explicitly locks "Lokale Heuristiken — kein LLM-API-Call". Do not add any Claude API invocation.
- **Separate panel/modal:** CONTEXT.md locked it as a tab in the existing analysis panel.
- **Regex-only rule format:** The audit-prompt.md should use structured key-value blocks (not free-form prose) so the parser is deterministic.
- **Path decoding assumptions:** The `~/.claude/projects/` dir name encoding must be validated, not assumed. Test with actual dirs before hardcoding decode logic.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Project path from encoded dir name | Custom decoder from scratch | Verify actual encoding from `ls ~/.claude/projects/` then build targeted decoder | Encoding is consistent but verify first |
| File type detection | Complex MIME detection | Simple path-based heuristics: `CLAUDE.md` = claude-md, `.claude/commands/**` = skill, `.claude/agents/**` = agent, `.claude.json` or `settings.json` = mcp | Files have predictable locations |
| Score weighting | Custom math | Simple weighted average: CLAUDE.md (40%), skills (30%), agents (20%), MCP (10%) — all adjustable via constants | Only 4 categories, trivial math |
| Severity color CSS | New CSS system | Reuse existing `.severity-praise`, `.severity-tip`, `.severity-warning`, `.severity-anti-pattern` classes from analysis panel | Already defined in analysis-panel.component.css |

**Key insight:** The audit engine is simpler than log-analyzer.ts (no streaming, no token math, no sequence analysis). The complexity is in defining good rules in audit-prompt.md, not in the engine code.

---

## Common Pitfalls

### Pitfall 1: Claude Projects Directory Encoding

**What goes wrong:** The project dirs under `~/.claude/projects/` use an encoding scheme that looks like `C--Dev-api` for `C:/Dev/api`. Decoding this incorrectly leads to paths that don't exist on disk.

**Why it happens:** Claude CLI encodes the absolute path into a filesystem-safe directory name. The encoding is not publicly documented.

**How to avoid:** Before writing the decoder, run `ls ~/.claude/projects/` and map 3-4 known paths to their encoded forms. From the codebase inspection:
- `C--Dev-claude-powerterminal` → `C:/Dev/claude-powerterminal`
- `C--Dev-api` → `C:/Dev/api`
- Pattern: Windows drive `C:` → `C`, path separators `/` → `--`, no `-` between drive and dir

**Confirmed pattern:** `C--Dev-project-name` → `C:/Dev/project-name`. The `--` is the path separator. On Unix, a leading `-` indicates root. Verify by checking if decoded paths exist on disk and fall back gracefully.

**Warning signs:** Audit shows 0 projects in dropdown, or paths that don't exist.

### Pitfall 2: Rule Parser Brittleness

**What goes wrong:** The audit-prompt.md parser breaks when rules are added/edited with slight formatting variations (extra spaces, different header levels, missing keys).

**Why it happens:** Regex-based parsers of human-edited markdown are fragile.

**How to avoid:** Use defensive parsing:
1. `### RULE XXX-NN` headers must be H3 (three `#`)
2. Key-value pairs: `**Key:** Value` — use `\*\*(\w[\w\s-]+)\*\*:\s*(.+)` regex
3. Unknown keys are ignored (not errors)
4. Rules with missing required fields (check, fix) are skipped with a console.warn

**Warning signs:** Fewer rules detected than expected, or `NaN` in scores.

### Pitfall 3: FormsModule Missing for ngModel

**What goes wrong:** Angular build fails with "Can't bind to 'ngModel' since it isn't a known property" when adding the project dropdown.

**Why it happens:** The analysis panel is a standalone component. `FormsModule` must be imported explicitly.

**How to avoid:** Add `FormsModule` to the imports array in the component decorator:
```typescript
import { FormsModule } from '@angular/forms';
@Component({
  imports: [CommonModule, FormsModule],
  ...
})
```

**Warning signs:** Build error during `ng build`.

### Pitfall 4: IPC Channel Registration Order

**What goes wrong:** Audit IPC handlers are registered after the analysis handlers, but they reference a function not yet exported from audit-engine.ts, causing a runtime error.

**Why it happens:** Circular imports or missing exports in the audit engine module.

**How to avoid:** Register audit handlers in `analysis-handlers.ts` (same file as existing handlers) and import from `audit-engine.ts`. Keep all analysis-related IPC registration in one place, consistent with existing pattern.

**Warning signs:** `ipcMain.handle` error in console, or "no handler for audit:run" in renderer.

### Pitfall 5: Cache Invalidation on Panel Re-open

**What goes wrong:** User re-opens the analysis panel and sees stale audit results from a previous project, because the cache key is not project-specific.

**Why it happens:** Audit cache uses a single variable instead of a Map keyed by project path.

**How to avoid:** Use `Map<string, { result: ProjectAuditResult; cachedAt: number }>` keyed by absolute project path, mirroring `sessionDetailCache` in `analysis-handlers.ts`.

**Warning signs:** Switching projects in dropdown shows previous project's results.

---

## Code Examples

### Audit Engine Core

```typescript
// electron/analysis/audit-engine.ts

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Load rules from audit-prompt.md at runtime
export function loadAuditRules(): AuditRule[] {
  const rulesPath = path.join(__dirname, 'audit-prompt.md');
  const content = fs.readFileSync(rulesPath, 'utf-8');
  return parseRules(content);
}

function parseRules(content: string): AuditRule[] {
  const rules: AuditRule[] = [];
  // Match H3 rule blocks: ### RULE CMD-01 ... (next ### RULE or end)
  const rulePattern = /^### RULE (\w+-\d+)\s*$([\s\S]*?)(?=^### RULE |\Z)/gm;
  let match;
  while ((match = rulePattern.exec(content)) !== null) {
    const id = match[1];
    const block = match[2];
    const get = (key: string): string | undefined => {
      const m = block.match(new RegExp(`\\*\\*${key}\\*\\*:\\s*(.+)`));
      return m?.[1]?.trim();
    };
    const rule: AuditRule = {
      id,
      category: (get('Category') ?? 'claude-md') as AuditRule['category'],
      severity: (get('Severity') ?? 'tip') as AuditRule['severity'],
      check: (get('Check') ?? 'content-regex') as AuditRule['check'],
      pattern: get('Pattern'),
      min: get('Min') ? parseInt(get('Min')!) : undefined,
      max: get('Max') ? parseInt(get('Max')!) : undefined,
      fix: get('Fix') ?? '',
    };
    if (rule.fix) rules.push(rule);
  }
  return rules;
}

export async function runProjectAudit(projectPath: string): Promise<ProjectAuditResult> {
  const rules = loadAuditRules();
  const files = discoverAuditFiles(projectPath);
  const fileResults: AuditFileResult[] = [];

  for (const f of files) {
    const content = fs.existsSync(f.path) ? fs.readFileSync(f.path, 'utf-8') : '';
    const lines = content.split('\n');
    const applicable = rules.filter(r => r.category === f.fileType);
    const findings: AuditFinding[] = [];

    for (const rule of applicable) {
      const passed = evaluateRule(rule, content, lines, projectPath);
      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        passed,
        detail: passed ? 'OK' : `Rule ${rule.id} failed`,
        fix: passed ? '' : rule.fix,
      });
    }

    const passedCount = findings.filter(f => f.passed).length;
    const score = applicable.length > 0
      ? Math.round((passedCount / applicable.length) * 100)
      : 100;

    fileResults.push({
      filePath: f.path,
      fileType: f.fileType,
      displayName: f.displayName,
      score,
      findings: findings.filter(f => !f.passed), // Only show failures
    });
  }

  const weights = { 'claude-md': 0.40, skill: 0.30, agent: 0.20, mcp: 0.10 };
  const overallScore = computeWeightedScore(fileResults, weights);

  return {
    projectPath,
    projectName: path.basename(projectPath),
    overallScore,
    improvementPotential: 100 - overallScore,
    files: fileResults,
    cachedAt: Date.now(),
  };
}

function evaluateRule(rule: AuditRule, content: string, lines: string[], projectPath: string): boolean {
  switch (rule.check) {
    case 'section-exists':
      return rule.pattern ? new RegExp(rule.pattern, 'im').test(content) : false;
    case 'length-check':
      return (rule.min === undefined || lines.length >= rule.min) &&
             (rule.max === undefined || lines.length <= rule.max);
    case 'content-regex':
      return rule.pattern ? new RegExp(rule.pattern, 'im').test(content) : false;
    case 'file-exists':
      return rule.pattern ? fs.existsSync(path.join(projectPath, rule.pattern)) : false;
    default:
      return true;
  }
}
```

### Project Discovery

```typescript
// Discovers projects from ~/.claude/projects/ directory
export function discoverClaudeProjects(): string[] {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsDir)) return [];

  return fs.readdirSync(projectsDir)
    .map(dir => decodeClaudeProjectDir(dir))
    .filter(p => p !== null && fs.existsSync(p) && fs.statSync(p).isDirectory())
    .sort() as string[];
}

function decodeClaudeProjectDir(encoded: string): string | null {
  try {
    // Windows: C--Dev-project → C:/Dev/project
    const winMatch = encoded.match(/^([A-Z])--(.+)$/);
    if (winMatch) {
      return `${winMatch[1]}:/${winMatch[2].replace(/--/g, '/')}`;
    }
    // Unix: -home-user-project → /home/user/project
    if (encoded.startsWith('-')) {
      return '/' + encoded.slice(1).replace(/--/g, '/');
    }
    return null;
  } catch {
    return null;
  }
}
```

### Audit File Discovery

```typescript
function discoverAuditFiles(projectPath: string): Array<{path: string; fileType: AuditRule['category']; displayName: string}> {
  const files: Array<{path: string; fileType: AuditRule['category']; displayName: string}> = [];

  // 1. CLAUDE.md (project root)
  const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
  files.push({ path: claudeMdPath, fileType: 'claude-md', displayName: 'CLAUDE.md' });

  // 2. Skills: .claude/commands/**/*.md
  const commandsDir = path.join(projectPath, '.claude', 'commands');
  if (fs.existsSync(commandsDir)) {
    const skillFiles = findMdFiles(commandsDir);
    for (const f of skillFiles) {
      files.push({
        path: f,
        fileType: 'skill',
        displayName: `.claude/commands/${path.relative(commandsDir, f)}`,
      });
    }
  }

  // 3. Agents: .claude/agents/**/*.md
  const agentsDir = path.join(projectPath, '.claude', 'agents');
  if (fs.existsSync(agentsDir)) {
    const agentFiles = findMdFiles(agentsDir);
    for (const f of agentFiles) {
      files.push({
        path: f,
        fileType: 'agent',
        displayName: `.claude/agents/${path.relative(agentsDir, f)}`,
      });
    }
  }

  // 4. MCP: .claude/settings.json or .mcp.json
  const mcpPaths = [
    { p: path.join(projectPath, '.claude', 'settings.json'), name: '.claude/settings.json' },
    { p: path.join(projectPath, '.mcp.json'), name: '.mcp.json' },
  ];
  for (const { p, name } of mcpPaths) {
    if (fs.existsSync(p)) {
      files.push({ path: p, fileType: 'mcp', displayName: name });
    }
  }

  return files;
}

function findMdFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) results.push(...findMdFiles(full));
      else if (entry.endsWith('.md')) results.push(full);
    }
  } catch { /* skip unreadable dirs */ }
  return results;
}
```

### Audit-Prompt.md Starter Template

This is the actual content to write at `electron/analysis/audit-prompt.md`:

```markdown
# Claude Project Configuration Audit Rules

Machine-parseable rule checklist. Each RULE block defines one heuristic check.
Format: ### RULE {CATEGORY}-{NN} with **Key:** Value pairs.

## CLAUDE.md Rules

### RULE CMD-01
**Category:** claude-md
**Severity:** warning
**Check:** file-exists
**Pattern:** CLAUDE.md
**Fix:** Add a CLAUDE.md file in the project root. This is the primary guidance file Claude reads for every session.

### RULE CMD-02
**Category:** claude-md
**Severity:** anti-pattern
**Check:** length-check
**Min:** 20
**Max:** 800
**Fix:** CLAUDE.md should be 20-800 lines. Shorter = insufficient guidance. Longer = Claude may skip sections.

### RULE CMD-03
**Category:** claude-md
**Severity:** tip
**Check:** section-exists
**Pattern:** ## (Build|Commands|Run)
**Fix:** Add a "## Build & Run Commands" section with how to build, test, and run the project.

### RULE CMD-04
**Category:** claude-md
**Severity:** warning
**Check:** section-exists
**Pattern:** ## (Critical|Rules|MUST|Wichtig)
**Fix:** Add a "## Critical Rules" or "## MUST" section for the most important non-negotiable conventions.

### RULE CMD-05
**Category:** claude-md
**Severity:** tip
**Check:** content-regex
**Pattern:** never|always|must|NEVER|ALWAYS|MUST
**Fix:** Use strong directive language (NEVER, ALWAYS, MUST) to make rules unambiguous for Claude.

## Skill Rules

### RULE SKL-01
**Category:** skill
**Severity:** warning
**Check:** section-exists
**Pattern:** ^---\s*$
**Fix:** Add YAML frontmatter (---) with name, description, and allowed-tools fields.

### RULE SKL-02
**Category:** skill
**Severity:** tip
**Check:** content-regex
**Pattern:** description:|name:
**Fix:** Add a "description:" field in frontmatter so Claude knows when to use this skill.

## Agent Rules

### RULE AGT-01
**Category:** agent
**Severity:** warning
**Check:** section-exists
**Pattern:** ^---\s*$
**Fix:** Add YAML frontmatter with name, description, and tools fields.

### RULE AGT-02
**Category:** agent
**Severity:** tip
**Check:** content-regex
**Pattern:** tools:
**Fix:** Define a "tools:" list to restrict which tools this agent can use. Unrestricted agents are harder to reason about.

### RULE AGT-03
**Category:** agent
**Severity:** warning
**Check:** content-regex
**Pattern:** <role>|## Role|## Goal
**Fix:** Add a clear <role> block or ## Role section defining what this agent does and doesn't do.

## MCP Server Config Rules

### RULE MCP-01
**Category:** mcp
**Severity:** warning
**Check:** content-regex
**Pattern:** mcpServers|mcp_servers
**Fix:** MCP config should define at least one mcpServers entry with command and args.

### RULE MCP-02
**Category:** mcp
**Severity:** tip
**Check:** content-regex
**Pattern:** "command":\s*"
**Fix:** Each MCP server entry needs a "command" field pointing to the server executable.
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| LLM-based code review | Deterministic static heuristics | Phase 8 (this phase) | Instant results, no API cost, reproducible |
| Full panel for new feature | Tab within existing panel | CONTEXT.md decision | Less UI surface, consistent UX |
| Ad-hoc file inspection | Structured rule file (audit-prompt.md) | Phase 8 (this phase) | Rules are versionable, improvable without code changes |

**What Claude project structure looks like (confirmed from ~/.claude inspection):**
- `~/.claude/CLAUDE.md` — global Claude instructions
- `~/.claude/commands/` — slash commands (skills), each is a `.md` file
- `~/.claude/agents/` — subagent definitions, each is a `.md` file
- Project root `CLAUDE.md` — project-specific instructions
- `.claude/settings.json` or `.mcp.json` — MCP server configurations

---

## Open Questions

1. **Path decoding edge cases**
   - What we know: `C--Dev-project` → `C:/Dev/project` on Windows
   - What's unclear: Projects with hyphens in the actual name (e.g., `my-project` in `C:/Dev/my-project`) produce `C--Dev-my-project` — how does the decoder distinguish `--` (separator) from `-` (hyphen within a segment)?
   - Recommendation: Verify against actual dirs. The Claude CLI uses `--` exclusively as path separator (not single `-`). Path segments with hyphens stay as single `-`. So `C--Dev-my-project` = `C:/Dev/my-project` is correctly decoded: `C:` + `/Dev` + `/my-project`.

2. **MCP config file locations**
   - What we know: MCP can be in `.claude/settings.json` (project) or global `~/.claude/settings.json`
   - What's unclear: Claude Code may use `.mcp.json` in project root or within `.claude/` — multiple possible locations
   - Recommendation: Check both `.claude/settings.json` and `.mcp.json` in project root; log which was found in the result.

3. **Audit cache TTL**
   - What we know: CONTEXT.md says "cache bis zum naechsten manuellen Trigger" (no TTL — cache until re-run)
   - What's unclear: Should cache persist across app restarts (requires disk write) or just in-memory?
   - Recommendation: In-memory cache only (Map<string, ...>), cleared on app restart. This matches session detail cache pattern and avoids stale-on-disk problem. Cache invalidated only when user clicks "Audit starten" again.

---

## Sources

### Primary (HIGH confidence)

- Direct codebase inspection — `electron/analysis/log-analyzer.ts` — audit engine pattern
- Direct codebase inspection — `electron/ipc/analysis-handlers.ts` — IPC handler pattern
- Direct codebase inspection — `electron/http/static-server.ts` — HTTP endpoint pattern
- Direct codebase inspection — `src/src/app/services/log-analysis.service.ts` — Angular service dual-transport
- Direct codebase inspection — `src/shared/analysis-types.ts` — TypeScript interface patterns
- Direct filesystem inspection — `~/.claude/projects/` directory listing — confirmed encoding scheme
- Direct filesystem inspection — `~/.claude/commands/`, `~/.claude/agents/` — confirmed Claude project structure

### Secondary (MEDIUM confidence)

- Phase 6/7 implementation decisions in STATE.md — caching patterns, service architecture
- CONTEXT.md locked decisions — architecture constraints confirmed

### Tertiary (LOW confidence)

- MCP config file location (.mcp.json vs .claude/settings.json) — multiple sources, needs validation at runtime

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all existing patterns reused
- Architecture: HIGH — direct mirror of log-analyzer.ts + analysis-panel patterns from codebase
- Claude project structure: HIGH — verified by direct inspection of ~/.claude/
- Path decoding: MEDIUM — pattern inferred from 10 observed directory names, edge cases flagged
- MCP config location: LOW — multiple possible file locations, needs runtime validation
- Audit rules content: MEDIUM — based on inspection of real CLAUDE.md files and Claude documentation patterns

**Research date:** 2026-02-28
**Valid until:** 2026-03-30 (stable domain — no fast-moving dependencies)
