# Phase 9: Local Code Review Panel - Research

**Researched:** 2026-02-28
**Domain:** Git diff parsing, rendering, and interactive code review UI
**Confidence:** HIGH

## Summary

Phase 9 adds a fullscreen overlay diff viewer to the dashboard, enabling inline code review of Claude's uncommitted changes. The core problem decomposes into four parts: (1) obtaining git diff output from the main process, (2) parsing and rendering it with syntax highlighting, (3) per-hunk accept/reject with git revert capabilities, and (4) inline comment storage and injection into terminal sessions.

The standard approach is `diff2html` (v3.4.x) for diff parsing and HTML rendering with built-in side-by-side/unified views and highlight.js integration. diff2html handles the heavy lifting of parsing unified diff format, rendering HTML with line numbers, and word-level inline diffs. It supports dark mode via CSS variables (`colorScheme: 'dark'`) which can be overridden with Catppuccin Mocha colors. For hunk-level revert, the approach is to reconstruct a minimal patch from the parsed DiffFile/DiffBlock structure and pipe it through `git apply --reverse` via `execFile` in the main process.

**Primary recommendation:** Use diff2html for diff parsing and rendering, override its dark mode CSS variables with Catppuccin Mocha colors, and implement hunk-level reject via reconstructed patches applied with `git apply --reverse`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Side-by-side and Unified diff views with a toggle button (default: side-by-side)
- 3 lines of context around changes (standard git diff default)
- Word-level diffs: changed words/characters highlighted inline within modified lines (like GitHub)
- New/added files shown collapsed by default with filename + line count header; click to expand
- Files can be marked as "reviewed" which collapses them back — visual progress indicator
- Changed files sorted in logical project-aware order, not alphabetical
- System detects project type (API, Angular, etc.) and orders files by architectural layer
- Project-type detection is automatic via heuristics (file patterns, directory structure)
- Fallback to alphabetical when project type is unclear
- Fullscreen overlay covering the entire dashboard (dashboard continues running underneath)
- Layout: file tree panel on the left, diff view on the right
- File tree displays full directory structure (like VS Code explorer), not flat list
- Status indicators on files: Modified (M), Added (A), Deleted (D)
- Close via X-button (top right) and Escape key — no confirmation dialog
- Click file in tree to view its diff
- Prev/Next buttons at the top of the diff view for sequential file browsing
- Keyboard shortcuts for navigation (up/down arrows in tree, Enter to open)
- "Review Changes" button appears in tile header when terminal status is WAITING or DONE AND uncommitted changes exist (git status check)
- Accept: marks hunk/file as accepted (visual confirmation, no git action needed)
- Reject: immediately reverts the hunk/file via `git checkout -p` / `git restore -p`
- Undo button appears after each reject (timed, ~10 seconds) as safety net
- File-level bulk operations: "Accept All" / "Reject All" buttons in each file header
- No global "Accept All Remaining" — review should be per-file at minimum
- Click on a diff line to add a comment — appears in a sidebar list on the right side of the diff view
- Each comment is a trackable task item with a checkbox (can be checked off as resolved)
- Two sending modes: "Send Now" (immediate prompt injection) and "Send Summary" (batch all comments for file)
- Send format: structured prompt — "Review-Feedback fuer [filename]:\n- Zeile 42: [comment]\n- Zeile 87: [comment]"
- Comments persist per terminal session (survive panel close, cleared when terminal session ends)
- Clicking a comment in the sidebar jumps to the relevant diff line

### Claude's Discretion
- Exact heuristics for project-type detection and layer ordering
- Syntax highlighting library/approach choice
- Exact keyboard shortcut mappings
- Undo button timing and animation
- Comment sidebar styling and layout details
- How git operations (restore, checkout) are executed safely in the background

### Deferred Ideas (OUT OF SCOPE)
- Automated Standard Reviews — System automatically evaluates Architecture, Code Quality, Security, and Test Quality of changes and displays scores/findings. Belongs in its own phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| REVW-01 | User can view Git diff inline within the dashboard with syntax highlighting | diff2html with highlight.js provides parsing, rendering, side-by-side/unified views, and syntax highlighting out of the box |
| REVW-02 | User can accept or reject changes per file or per hunk | diff2html's DiffFile/DiffBlock structure enables per-hunk identification; `git apply --reverse` with reconstructed patch enables non-interactive hunk revert |
| REVW-03 | User can place inline review comments on specific diff lines | diff2html renders line numbers as data attributes; click handler can capture line number + file context; comments stored in Angular service per session |
| REVW-04 | Review panel appears contextually when a terminal reaches WAITING or DONE status | Existing status detection (StatusDetector) and git context polling (GitContextService) provide status + uncommitted change count; "Review Changes" button visibility is a computed condition |
| REVW-05 | Works in both Electron app and remote browser | New IPC channels for git diff/apply with HTTP API mirrors in static-server.ts, following established dual-transport pattern |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| diff2html | ^3.4.56 | Parse unified diff strings into DiffFile[] and render as HTML with syntax highlighting | De facto standard for diff rendering in web apps; 10K+ GitHub stars; supports side-by-side, unified, word-level diffs, dark mode via CSS; built-in highlight.js integration |
| highlight.js | ^11.11.x | Syntax highlighting engine (used by diff2html internally) | diff2html's built-in syntax highlighting uses highlight.js; no separate install needed — diff2html bundles it in Diff2HtmlUI |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | — | — | diff2html bundles everything needed; no additional libraries required |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| diff2html | monaco-diff-editor | Monaco is far heavier (~5MB), overkill for read-only diff viewing; diff2html is 60KB gzipped |
| diff2html | react-diff-view | React-only, doesn't work with Angular |
| diff2html | git-diff-view | Multi-framework support but newer, less battle-tested; diff2html has wider adoption |
| Custom diff parsing | diff2html.parse() | Custom parsing is error-prone; unified diff format has edge cases (binary files, renames, mode changes) that diff2html handles |

**Installation:**
```bash
cd src && npm install diff2html
```

Note: diff2html ships with TypeScript types included. The `Diff2HtmlUI` class (from `diff2html/lib/ui/js/diff2html-ui-slim`) uses highlight.js for syntax highlighting — no separate highlight.js install required if using Diff2HtmlUI. If using the low-level `Diff2Html.parse()` + `Diff2Html.html()` API (recommended for custom rendering with per-hunk controls), highlight.js languages are also bundled.

## Architecture Patterns

### Recommended Project Structure
```
src/src/app/
├── components/
│   └── code-review/
│       ├── code-review-panel.component.ts    # Fullscreen overlay (like session-detail but full-width)
│       ├── code-review-panel.component.html
│       ├── code-review-panel.component.css
│       ├── file-tree.component.ts            # Left sidebar file tree
│       ├── file-tree.component.html
│       ├── file-tree.component.css
│       ├── diff-viewer.component.ts          # Right panel diff renderer
│       ├── diff-viewer.component.html
│       ├── diff-viewer.component.css
│       ├── comment-sidebar.component.ts      # Right sidebar comment list
│       ├── comment-sidebar.component.html
│       └── comment-sidebar.component.css
├── services/
│   └── code-review.service.ts                # Git diff fetching, hunk operations, comment state
├── models/
│   └── code-review.model.ts                  # ReviewFile, ReviewHunk, ReviewComment interfaces
electron/
├── ipc/
│   └── review-handlers.ts                    # Git diff, apply --reverse, restore handlers
```

### Pattern 1: Fullscreen Overlay (following session-detail precedent)
**What:** The code review panel is a fullscreen fixed overlay at z-index 1001 (above session-detail's z-index 1000), rendered via `*ngIf` in app.component.html.
**When to use:** When the review panel is opened from a tile header button.
**Example:**
```typescript
// app.component.ts — adds review panel state
reviewSessionId: string | null = null;
reviewCwd: string | null = null;

onReviewChanges(event: { sessionId: string; cwd: string }): void {
  this.reviewSessionId = event.sessionId;
  this.reviewCwd = event.cwd;
}

closeReview(): void {
  this.reviewSessionId = null;
  this.reviewCwd = null;
}
```
```html
<!-- app.component.html -->
<app-code-review-panel
  *ngIf="reviewSessionId"
  [sessionId]="reviewSessionId"
  [cwd]="reviewCwd"
  (close)="closeReview()">
</app-code-review-panel>
```

### Pattern 2: Dual-Transport IPC/HTTP (following existing pattern)
**What:** New IPC channels for git operations, mirrored as HTTP endpoints for remote browser support.
**When to use:** All git diff and apply operations.
**Example:**
```typescript
// electron/ipc/review-handlers.ts
import { ipcMain } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export function registerReviewHandlers(): void {
  // Get full unified diff for all uncommitted changes
  ipcMain.handle('review:diff', async (_event, cwd: string): Promise<string> => {
    const result = await execFileAsync('git', ['diff', 'HEAD', '--unified=3'], {
      cwd,
      timeout: 15000,  // longer timeout for large diffs
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large diffs
    });
    return result.stdout;
  });

  // Reject a hunk by applying its reverse patch
  ipcMain.handle('review:reject-hunk', async (_event, cwd: string, patchContent: string): Promise<{ success: boolean; error?: string }> => {
    try {
      await execFileAsync('git', ['apply', '--reverse', '--unidiff-zero'], {
        cwd,
        timeout: 5000,
        windowsHide: true,
        input: patchContent,  // Note: execFile doesn't support stdin — use spawn instead
      });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Reject entire file (revert all changes)
  ipcMain.handle('review:reject-file', async (_event, cwd: string, filePath: string): Promise<{ success: boolean; error?: string }> => {
    try {
      await execFileAsync('git', ['checkout', 'HEAD', '--', filePath], {
        cwd,
        timeout: 5000,
        windowsHide: true,
      });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
```

### Pattern 3: diff2html Parse → Custom Render (for per-hunk controls)
**What:** Use diff2html's `parse()` to get structured DiffFile[], but render custom HTML instead of using diff2html's built-in renderer, so we can attach per-hunk accept/reject buttons and click handlers on individual lines.
**When to use:** When you need interactive elements embedded within the diff view.
**Example:**
```typescript
import { parse as parseDiff, DiffFile } from 'diff2html';

// Parse the raw diff string
const files: DiffFile[] = parseDiff(rawDiffOutput);

// Each DiffFile has:
// - oldName: string (previous file path)
// - newName: string (current file path)
// - addedLines: number
// - deletedLines: number
// - isCombined: boolean
// - isGitDiff: boolean
// - blocks: DiffBlock[]

// Each DiffBlock (hunk) has:
// - oldStartLine: number
// - oldStartLine2?: number (combined diff)
// - newStartLine: number
// - header: string (@@ -1,3 +1,4 @@)
// - lines: DiffLine[]

// Each DiffLine has:
// - type: LineType (INSERT, DELETE, CONTEXT)
// - oldNumber?: number
// - newNumber?: number
// - content: string
```

**Alternative approach — use diff2html's HTML output and augment it:**
```typescript
import { html as diffHtml } from 'diff2html';

// Generate standard diff2html HTML
const renderedHtml = diffHtml(files, {
  outputFormat: 'side-by-side',
  drawFileList: false,
  matching: 'lines',
  diffStyle: 'word',
  colorScheme: 'dark',
});

// Then use DOM manipulation to:
// 1. Inject accept/reject buttons before each d2h-diff-tbody (hunk container)
// 2. Add click handlers on d2h-code-linenumber elements for comments
// 3. Add file-level action buttons in d2h-file-header elements
```

**Recommendation:** Use the hybrid approach — let diff2html render the HTML (which handles complex word-level highlighting, line numbering, etc.) then use Angular's Renderer2 or direct DOM manipulation to augment the rendered HTML with interactive elements. This avoids rebuilding diff2html's rendering logic from scratch.

### Pattern 4: Hunk-Level Revert via Reconstructed Patch
**What:** To reject a single hunk, reconstruct a minimal valid patch from the DiffFile/DiffBlock data and pipe it to `git apply --reverse`.
**When to use:** When user clicks "Reject" on a specific hunk.
**Example:**
```typescript
/**
 * Reconstruct a valid unified diff patch for a single hunk.
 * This patch can be piped to `git apply --reverse` to undo just that hunk.
 */
function buildHunkPatch(file: DiffFile, blockIndex: number): string {
  const block = file.blocks[blockIndex];
  const lines: string[] = [
    `--- a/${file.oldName}`,
    `+++ b/${file.newName}`,
    block.header, // e.g., @@ -10,7 +10,8 @@
  ];

  for (const line of block.lines) {
    // diff2html line.content already includes the +/-/space prefix
    lines.push(line.content);
  }

  return lines.join('\n') + '\n';
}
```

**Critical detail:** `execFile` does not support stdin. For piping patch content, use `child_process.spawn` with stdin write:
```typescript
import { spawn } from 'child_process';

function applyReversePatch(cwd: string, patchContent: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['apply', '--reverse', '--unidiff-zero'], {
      cwd,
      windowsHide: true,
    });

    let stderr = '';
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: stderr || `Exit code ${code}` });
      }
    });
    proc.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    proc.stdin.write(patchContent);
    proc.stdin.end();
  });
}
```

### Pattern 5: Comment Injection into Terminal via PTY Write
**What:** When user clicks "Send Now" or "Send Summary", the comment(s) are formatted as a structured prompt and written to the terminal's PTY stdin.
**When to use:** When sending review feedback to Claude.
**Example:**
```typescript
// Existing PtyManagerService.writeToSession() already supports this
async sendComment(sessionId: string, filename: string, line: number, comment: string): Promise<void> {
  const prompt = `Review-Feedback fuer ${filename}:\n- Zeile ${line}: ${comment}\n`;
  await this.ptyManagerService.writeToSession(sessionId, prompt);
}

async sendSummary(sessionId: string, filename: string, comments: ReviewComment[]): Promise<void> {
  const lines = comments.map(c => `- Zeile ${c.line}: ${c.text}`).join('\n');
  const prompt = `Review-Feedback fuer ${filename}:\n${lines}\n`;
  await this.ptyManagerService.writeToSession(sessionId, prompt);
}
```

### Pattern 6: Project-Type Detection for File Ordering
**What:** Detect the project type from file patterns and directory structure, then sort changed files by architectural layer.
**When to use:** When building the file tree from the parsed diff.
**Example:**
```typescript
interface ProjectType {
  name: string;
  layerOrder: string[];  // directory/file patterns in review order
}

const PROJECT_TYPES: ProjectType[] = [
  {
    name: 'angular',
    layerOrder: [
      'routes',      // app.routes.ts, *.routes.ts
      'components',  // *.component.ts
      'services',    // *.service.ts
      'models',      // *.model.ts, interfaces
      'shared',      // shared utilities
      'tests',       // *.spec.ts
    ],
  },
  {
    name: 'express-api',
    layerOrder: [
      'routes',      // routes/, *.routes.ts
      'controllers', // controllers/
      'managers',    // managers/, services/
      'brokers',     // brokers/
      'models',      // models/, persistence/
      'middleware',  // middleware/
      'tests',       // tests/, *.test.ts
    ],
  },
];

function detectProjectType(changedFiles: string[], allFiles?: string[]): ProjectType | null {
  // Heuristics:
  // - Has angular.json or src/app/ → Angular
  // - Has routes/ + controllers/ or managers/ → Express API
  // - Has package.json with @angular/core → Angular
  // - Fallback: null (use alphabetical)
  // ...
}

function sortFilesByLayer(files: DiffFile[], projectType: ProjectType): DiffFile[] {
  return [...files].sort((a, b) => {
    const aLayer = getLayerIndex(a.newName || a.oldName, projectType);
    const bLayer = getLayerIndex(b.newName || b.oldName, projectType);
    if (aLayer !== bLayer) return aLayer - bLayer;
    return (a.newName || a.oldName).localeCompare(b.newName || b.oldName);
  });
}
```

### Anti-Patterns to Avoid
- **Re-implementing diff parsing:** diff2html handles edge cases (binary files, renames, mode changes, combined diffs, no-newline-at-end) that manual parsing would miss.
- **Using `git checkout -p` or `git restore -p` for hunk revert:** These are interactive commands requiring stdin interaction. Use `git apply --reverse` with a constructed patch instead.
- **Loading entire diff output into Angular component state:** Large diffs can be megabytes. Parse once, render on demand per file, virtualize the file list.
- **Using innerHTML binding for diff2html output in Angular:** Angular sanitizes innerHTML, stripping classes and attributes. Use `[innerHTML]` with DomSanitizer.bypassSecurityTrustHtml() or use Renderer2 to set innerHTML directly on nativeElement.
- **Blocking the main process with large diffs:** Set maxBuffer on execFile (10MB) and add timeout (15s). Consider streaming for very large repos.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Unified diff parsing | Custom regex parser | `diff2html.parse()` | Unified diff format has 20+ edge cases (binary, renames, mode changes, combined diffs, git-specific extensions) |
| Diff HTML rendering | Custom line-by-line renderer | `diff2html.html()` | Side-by-side alignment, word-level highlighting, line numbering, and synchronized scrolling are complex to implement correctly |
| Syntax highlighting | Custom tokenizer | highlight.js (via diff2html) | 190+ language grammars, tested and maintained |
| Dark mode CSS variables | Custom color calculations | diff2html's `colorScheme: 'dark'` + CSS variable overrides | diff2html already defines all needed CSS variables for dark mode |

**Key insight:** diff2html solves the hard rendering problems. The custom work is in the _interaction layer_ (accept/reject buttons, click-to-comment, file tree) which wraps around diff2html's output.

## Common Pitfalls

### Pitfall 1: Angular innerHTML Sanitization Strips diff2html Output
**What goes wrong:** Using `[innerHTML]="diffHtml"` causes Angular's DomSanitizer to strip CSS classes and data attributes from diff2html's output, breaking styling and line number references.
**Why it happens:** Angular sanitizes all innerHTML bindings by default to prevent XSS.
**How to avoid:** Use `DomSanitizer.bypassSecurityTrustHtml(diffHtml)` or use `Renderer2` / `ElementRef.nativeElement.innerHTML` to bypass sanitization. The diff content comes from git (trusted source), so this is safe.
**Warning signs:** Diff renders as plain text without colors, or side-by-side layout breaks.

### Pitfall 2: Stale Diff After Hunk Reject
**What goes wrong:** After rejecting a hunk, the displayed diff no longer matches the file system. Other hunks in the same file may have shifted line numbers.
**Why it happens:** Rejecting a hunk modifies the working tree, invalidating the original diff.
**How to avoid:** After any reject operation, re-fetch the full diff from git and re-parse. Update the UI to reflect the new state. The rejected hunk will disappear from the new diff.
**Warning signs:** Line numbers in remaining hunks are wrong; accepting/rejecting a second hunk fails.

### Pitfall 3: execFile Cannot Pipe Stdin for git apply
**What goes wrong:** `execFile('git', ['apply', '--reverse'], { input: patchContent })` silently fails — `input` option is not supported by `execFile`.
**Why it happens:** Node.js `execFile` doesn't support the `input` option (only `exec` and `execSync` do). Must use `spawn` with manual stdin write.
**How to avoid:** Use `child_process.spawn` and write to `proc.stdin`, then call `proc.stdin.end()`.
**Warning signs:** Hunk reject appears to succeed but file is unchanged.

### Pitfall 4: diff2html CSS Not Loaded
**What goes wrong:** Diff renders as unstyled HTML — no colors, no side-by-side layout, no line numbers.
**Why it happens:** diff2html's CSS file is not imported in the Angular component or global styles.
**How to avoid:** Import diff2html CSS in `angular.json` styles array or via `@import` in the component's CSS. Also ensure highlight.js theme CSS is loaded for syntax highlighting colors.
**Warning signs:** Raw HTML structure is correct but completely unstyled.

### Pitfall 5: Large Diffs Cause Memory Issues or Timeouts
**What goes wrong:** Repositories with many changed files or large file diffs cause the git diff command to timeout or exceed the default 200KB buffer.
**Why it happens:** Default `maxBuffer` for `execFile` is 200KB in older Node versions, 1MB in newer ones. Large diffs can exceed this.
**How to avoid:** Set `maxBuffer: 10 * 1024 * 1024` (10MB) on the git diff execFile call. Set a generous timeout (15 seconds). For truly massive diffs, consider chunked loading (diff per file rather than all at once).
**Warning signs:** "stdout maxBuffer exceeded" error, or timeout errors in the main process.

### Pitfall 6: Remote Browser Cannot Use execFile for Git
**What goes wrong:** In remote browser mode, IPC is unavailable, so git operations must go through HTTP API.
**Why it happens:** Existing pattern — all main-process operations need HTTP mirrors for remote browser support.
**How to avoid:** Add HTTP API endpoints for all review operations (`GET /api/review/diff?cwd=...`, `POST /api/review/reject-hunk`, `POST /api/review/reject-file`) in static-server.ts, following the existing pattern. The code-review.service.ts should check `window.electronAPI` and route accordingly.
**Warning signs:** Review panel loads in Electron but fails silently in remote browser.

### Pitfall 7: Undo After Reject Requires Storing Original Content
**What goes wrong:** The "Undo" button after a reject has no content to restore because the original hunk data was discarded.
**Why it happens:** Once `git apply --reverse` runs, the working tree has changed. The original hunk content is only available from the pre-reject diff.
**How to avoid:** Before executing a reject, store the original patch content (the forward patch). To undo, apply the stored patch with `git apply` (without `--reverse`) to re-apply the original change.
**Warning signs:** Undo button doesn't restore the original code, or restores incorrect content.

## Code Examples

### Initializing diff2html with Dark Mode in Angular
```typescript
// diff-viewer.component.ts
import { Component, ElementRef, ViewChild, Input, OnChanges } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { html as renderDiffHtml, parse as parseDiff } from 'diff2html';
import type { DiffFile } from 'diff2html/lib/types';

@Component({
  selector: 'app-diff-viewer',
  template: `<div #diffContainer class="diff-container d2h-dark-color-scheme"></div>`,
  styleUrls: ['./diff-viewer.component.css'],
})
export class DiffViewerComponent implements OnChanges {
  @Input() rawDiff: string = '';
  @Input() outputFormat: 'side-by-side' | 'line-by-line' = 'side-by-side';
  @ViewChild('diffContainer', { static: true }) diffContainer!: ElementRef;

  private parsedFiles: DiffFile[] = [];

  ngOnChanges(): void {
    this.parsedFiles = parseDiff(this.rawDiff);
    const html = renderDiffHtml(this.parsedFiles, {
      outputFormat: this.outputFormat,
      drawFileList: false,
      matching: 'lines',
      diffStyle: 'word',
      colorScheme: 'dark',
    });
    // Direct nativeElement assignment avoids Angular sanitizer stripping classes
    this.diffContainer.nativeElement.innerHTML = html;
    this.attachHunkControls();
  }

  private attachHunkControls(): void {
    // Find all hunk headers and inject accept/reject buttons
    const hunkHeaders = this.diffContainer.nativeElement.querySelectorAll('.d2h-code-side-linenumber, .d2h-info');
    // ... attach click handlers
  }
}
```

### Catppuccin Mocha CSS Override for diff2html Dark Mode
```css
/* Override diff2html dark mode CSS variables with Catppuccin Mocha palette */
.d2h-dark-color-scheme {
  --d2h-dark-bg-color: #1e1e2e;                 /* base */
  --d2h-dark-border-color: #313244;              /* surface0 */
  --d2h-dark-color: #cdd6f4;                     /* text */
  --d2h-dark-file-header-bg-color: #181825;      /* mantle */
  --d2h-dark-line-number-color: #6c7086;         /* overlay0 */
  --d2h-dark-empty-line-bg-color: #11111b;       /* crust */
  --d2h-dark-ins-bg-color: rgba(166, 227, 161, 0.15);  /* green with alpha */
  --d2h-dark-ins-highlight-bg-color: rgba(166, 227, 161, 0.30);
  --d2h-dark-del-bg-color: rgba(243, 139, 168, 0.15);  /* red with alpha */
  --d2h-dark-del-highlight-bg-color: rgba(243, 139, 168, 0.30);
  --d2h-dark-info-bg-color: #181825;             /* mantle */
  --d2h-dark-info-color: #89b4fa;                /* blue */
}

/* Override highlight.js colors for Catppuccin Mocha */
.d2h-dark-color-scheme .hljs {
  background: #1e1e2e;
  color: #cdd6f4;
}
.d2h-dark-color-scheme .hljs-keyword { color: #cba6f7; }  /* mauve */
.d2h-dark-color-scheme .hljs-string { color: #a6e3a1; }   /* green */
.d2h-dark-color-scheme .hljs-number { color: #fab387; }   /* peach */
.d2h-dark-color-scheme .hljs-comment { color: #6c7086; }  /* overlay0 */
.d2h-dark-color-scheme .hljs-function { color: #89b4fa; } /* blue */
.d2h-dark-color-scheme .hljs-title { color: #89b4fa; }    /* blue */
.d2h-dark-color-scheme .hljs-type { color: #f9e2af; }     /* yellow */
.d2h-dark-color-scheme .hljs-built_in { color: #f38ba8; } /* red */
.d2h-dark-color-scheme .hljs-attr { color: #f9e2af; }     /* yellow */
```

### IPC Channel Registration Pattern
```typescript
// src/shared/ipc-channels.ts — add new channels
export const IPC_CHANNELS = {
  // ... existing channels ...

  // Code review channels
  REVIEW_DIFF: 'review:diff',
  REVIEW_REJECT_HUNK: 'review:reject-hunk',
  REVIEW_REJECT_FILE: 'review:reject-file',
  REVIEW_DIFF_FILE: 'review:diff-file',    // single file diff
} as const;
```

### Comment State Management
```typescript
// services/code-review.service.ts
export interface ReviewComment {
  id: string;
  sessionId: string;
  filename: string;
  line: number;
  text: string;
  resolved: boolean;
  createdAt: Date;
}

@Injectable({ providedIn: 'root' })
export class CodeReviewService {
  // Comments stored per session — Map<sessionId, ReviewComment[]>
  private comments = new Map<string, ReviewComment[]>();

  addComment(sessionId: string, filename: string, line: number, text: string): ReviewComment {
    const comment: ReviewComment = {
      id: crypto.randomUUID(),
      sessionId,
      filename,
      line,
      text,
      resolved: false,
      createdAt: new Date(),
    };
    const existing = this.comments.get(sessionId) || [];
    existing.push(comment);
    this.comments.set(sessionId, existing);
    return comment;
  }

  getComments(sessionId: string, filename?: string): ReviewComment[] {
    const all = this.comments.get(sessionId) || [];
    return filename ? all.filter(c => c.filename === filename) : all;
  }

  clearSession(sessionId: string): void {
    this.comments.delete(sessionId);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| diff2html light-only | diff2html with `colorScheme: 'dark'` + CSS variables | Sept 2023 (v3.4.35) | Native dark mode support; no need for custom CSS hacks |
| Diff2HtmlUI (full bundle) | diff2html/lib/ui/js/diff2html-ui-slim | v3.x | Slim build excludes highlight.js bundle; use if you want to provide your own hljs instance |
| `git checkout -- file` for revert | `git restore file` (Git 2.23+) | Git 2.23 (Aug 2019) | Both work; `git checkout HEAD -- file` is more universally supported and clearer in intent for file-level revert |

**Deprecated/outdated:**
- `Diff2Html.getJsonFromDiff()` → renamed to `Diff2Html.parse()` in v3.x
- `Diff2Html.getPrettyHtml()` → renamed to `Diff2Html.html()` in v3.x

## Open Questions

1. **diff2html CSS variable exact names for dark mode**
   - What we know: diff2html uses CSS variables prefixed with `--d2h-dark-` for dark mode, set via the `.d2h-dark-color-scheme` class.
   - What's unclear: The exact, complete list of CSS variable names is not in the public docs. They're defined in the source SCSS files.
   - Recommendation: After installing diff2html, inspect the shipped CSS file (`node_modules/diff2html/bundles/css/diff2html.min.css`) to find all `--d2h-dark-*` variables. Override them in the component CSS.
   - Confidence: MEDIUM — the pattern is confirmed, exact variable names need validation at implementation time.

2. **diff2html line content prefix format**
   - What we know: `DiffLine.content` contains the line content. The exact format (whether it includes the +/-/space prefix or not) matters for reconstructing patches.
   - What's unclear: Docs are ambiguous. Some examples show the prefix included, others don't.
   - Recommendation: Test at implementation time with a real diff. If prefix is not included, prepend based on `line.type` (INSERT → '+', DELETE → '-', CONTEXT → ' ').
   - Confidence: MEDIUM — easy to verify at implementation time.

3. **Undo timing for reject operations**
   - What we know: User wants a timed undo button (~10 seconds) after reject.
   - What's unclear: Exact UX — should the undo button replace the reject button? Float? Fade out?
   - Recommendation: Show a toast-like notification at the bottom of the diff viewer with "Undo" button. Auto-dismiss after 10 seconds. Store the forward patch for the duration of the undo window.
   - Confidence: HIGH — this is a UI pattern decision within Claude's discretion.

## Sources

### Primary (HIGH confidence)
- [diff2html GitHub + README](https://github.com/rtfpessoa/diff2html) — API reference, configuration options, TypeScript types
- [diff2html npm](https://www.npmjs.com/package/diff2html) — v3.4.56 confirmed current
- [Context7 /rtfpessoa/diff2html](https://context7.com) — DiffFile/DiffBlock/DiffLine structure, configuration API, code examples
- [highlight.js GitHub](https://github.com/highlightjs/highlight.js) — syntax highlighting integration

### Secondary (MEDIUM confidence)
- [DeepWiki diff2html configuration](https://deepwiki.com/rtfpessoa/diff2html/4-configuration-options) — CSS variable theming, color scheme architecture
- [diff2html dark mode PR #514](https://github.com/rtfpessoa/diff2html/issues/403) — confirmed dark mode added Sept 2023
- [git-scm.com git-apply docs](https://git-scm.com/docs/git-apply) — `--reverse` flag for patch reversal

### Tertiary (LOW confidence)
- diff2html CSS variable exact names — need validation from shipped CSS at implementation time
- DiffLine.content prefix format — need validation with real diff output

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — diff2html is the de facto standard, confirmed via npm, Context7, and GitHub
- Architecture: HIGH — follows established project patterns (overlay, dual-transport IPC/HTTP, Angular services)
- Pitfalls: HIGH — identified from project history (Angular sanitizer, execFile limitations) and diff2html documentation
- Git operations: MEDIUM — `git apply --reverse` approach is well-documented but hunk reconstruction needs validation

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable domain, diff2html is mature)
