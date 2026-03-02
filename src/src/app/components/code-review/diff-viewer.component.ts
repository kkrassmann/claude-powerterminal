import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  OnDestroy,
  ViewChild,
  ElementRef,
  ViewEncapsulation,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { html as renderDiffHtml } from 'diff2html';
import type { DiffFile, DiffBlock } from 'diff2html/lib/types';
import { ColorSchemeType } from 'diff2html/lib/types';
import { CodeReviewService } from '../../services/code-review.service';

/**
 * Event emitted when a diff line is clicked (for comment placement).
 */
export interface LineClickEvent {
  filename: string;
  line: number;
  side: 'old' | 'new';
}

/**
 * Diff viewer component — renders a single file's diff using diff2html.
 *
 * Features:
 * - Side-by-side and unified view via outputFormat input
 * - Word-level inline diffs (diffStyle: 'word')
 * - Catppuccin Mocha dark theme via CSS variable overrides
 * - highlight.js syntax highlighting with Catppuccin color palette
 * - New/added files shown collapsed by default with expand toggle
 * - Per-hunk Accept/Reject buttons injected into diff2html output
 * - File-level Accept All / Reject All bulk operations
 * - Undo toast (10s) after a hunk reject, restores via forward patch
 * - Line click handlers for inline comment placement
 *
 * IMPORTANT: Uses nativeElement.innerHTML directly — Angular's [innerHTML] binding
 * strips CSS classes and data attributes from diff2html output (sanitizer issue).
 * diff content comes from git (trusted source), so direct DOM assignment is safe.
 */
@Component({
  selector: 'app-diff-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './diff-viewer.component.html',
  styleUrls: ['./diff-viewer.component.css'],
  // ViewEncapsulation.None: lets our CSS override diff2html's global classes
  // since this is a fullscreen overlay, style leakage is minimal and contained
  encapsulation: ViewEncapsulation.None,
})
export class DiffViewerComponent implements OnChanges, OnDestroy {
  @Input() file: DiffFile | null = null;
  @Input() outputFormat: 'side-by-side' | 'line-by-line' = 'side-by-side';
  @Input() rawDiff = '';
  @Input() sessionId = '';
  @Input() cwd = '';

  /** Emitted when a line number is clicked for comment placement */
  @Output() lineClicked = new EventEmitter<LineClickEvent>();

  /** Emitted when a comment is submitted via the inline input */
  @Output() commentSubmitted = new EventEmitter<{ line: number; text: string }>();

  /** Emitted after a hunk or file reject succeeds (parent should re-fetch diff) */
  @Output() hunkRejected = new EventEmitter<void>();
  @Output() fileRejected = new EventEmitter<void>();

  /** Emitted when "Reviewed" toggle is clicked for the current file */
  @Output() fileReviewed = new EventEmitter<{ filename: string; reviewed: boolean }>();

  @ViewChild('diffContainer', { static: true }) diffContainer!: ElementRef<HTMLDivElement>;

  /** Whether an added file is expanded (added files start collapsed) */
  isAddedFileExpanded = false;

  /** Whether the file is marked as reviewed */
  isReviewed = false;

  /** Inline comment input state */
  commentInputLine: number | null = null;
  commentInputText = '';
  commentInputVisible = false;

  /** Undo toast state */
  undoVisible = false;
  undoMessage = '';
  private undoPatchContent = '';
  private undoTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /** Track accepted hunk indices (visual marking only, no git op) */
  acceptedHunks = new Set<number>();

  /** Whether a reject operation is in progress */
  isRejecting = false;

  /** Cache of the last rendered file path to avoid re-renders when only index changes */
  private lastRenderedPath = '';
  private lastFormat = '';

  constructor(private codeReviewService: CodeReviewService) {}

  ngOnChanges(): void {
    if (!this.file) {
      this.clearContainer();
      return;
    }

    const currentPath = this.file.newName !== '/dev/null' ? this.file.newName : this.file.oldName;
    const formatChanged = this.lastFormat !== this.outputFormat;
    const fileChanged = this.lastRenderedPath !== currentPath;

    if (!fileChanged && !formatChanged) return;

    // Reset state when switching to a new file
    if (fileChanged) {
      if (this.isAddedFile(this.file)) {
        this.isAddedFileExpanded = false;
      }
      this.isReviewed = false;
      this.acceptedHunks.clear();
      this.closeCommentInput();
      this.clearUndo();
    }

    this.lastRenderedPath = currentPath;
    this.lastFormat = this.outputFormat;

    this.renderDiff();
  }

  ngOnDestroy(): void {
    this.clearUndo();
  }

  private isAddedFile(file: DiffFile): boolean {
    return file.oldName === '/dev/null' || file.oldName === 'dev/null';
  }

  private clearContainer(): void {
    if (this.diffContainer?.nativeElement) {
      this.diffContainer.nativeElement.innerHTML = '';
    }
    this.lastRenderedPath = '';
  }

  expandAddedFile(): void {
    this.isAddedFileExpanded = true;
    this.renderDiff();
  }

  private renderDiff(): void {
    if (!this.file || !this.diffContainer?.nativeElement) return;

    // For added files that are collapsed, show the placeholder instead
    if (this.isAddedFile(this.file) && !this.isAddedFileExpanded) {
      this.diffContainer.nativeElement.innerHTML = '';
      return;
    }

    // Extract single-file diff from rawDiff by matching the diff header for this file
    const fileDiff = this.extractFileDiff(this.file);
    if (!fileDiff) {
      this.diffContainer.nativeElement.innerHTML =
        '<div class="diff-empty">No diff content available for this file.</div>';
      return;
    }

    // Render using diff2html.html() — handles word-level highlighting, line numbering, alignment
    const html = renderDiffHtml(fileDiff, {
      outputFormat: this.outputFormat,
      drawFileList: false,
      matching: 'lines',
      diffStyle: 'word',
      colorScheme: ColorSchemeType.DARK,
    });

    // Direct nativeElement assignment — avoids Angular sanitizer stripping CSS classes
    this.diffContainer.nativeElement.innerHTML = html;

    // Inject per-hunk accept/reject buttons after rendering
    this.injectHunkControls(this.file, fileDiff);

    // Attach line click handlers for comment placement
    this.attachLineClickHandlers(this.file);
  }

  /**
   * Extract the single-file portion from the full raw diff string.
   * Finds the diff header matching this file and returns everything until the next diff header.
   */
  private extractFileDiff(file: DiffFile): string {
    if (!this.rawDiff) return '';

    // Find by newName or oldName in the diff header
    const searchNames = [file.newName, file.oldName].filter(
      n => n && n !== '/dev/null' && n !== 'dev/null'
    );

    const lines = this.rawDiff.split('\n');
    let startIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('diff --git')) {
        if (searchNames.some(name => line.includes(name))) {
          startIdx = i;
          break;
        }
      }
    }

    if (startIdx === -1) return this.rawDiff; // Fallback: use full diff

    // Find the end: next 'diff --git' header
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith('diff --git')) {
        endIdx = i;
        break;
      }
    }

    return lines.slice(startIdx, endIdx).join('\n');
  }

  /**
   * Inject per-hunk Accept/Reject control buttons into the diff2html rendered output.
   * Also injects file-level Accept All / Reject All buttons in the file header.
   *
   * diff2html renders each hunk with a `.d2h-info` row for the hunk header (@@...@@).
   * We insert a controls bar before each such row.
   */
  private injectHunkControls(file: DiffFile, fileDiff: string): void {
    const container = this.diffContainer.nativeElement;
    const filename = file.newName !== '/dev/null' ? file.newName : file.oldName;

    // --- File-level header controls (Accept All / Reject All) ---
    const fileHeader = container.querySelector('.d2h-file-header');
    if (fileHeader) {
      const fileControls = document.createElement('div');
      fileControls.className = 'hunk-controls file-controls';
      fileControls.innerHTML = `
        <button class="hunk-btn accept-btn accept-all-btn" title="Accept all changes in this file">&#x2713; Accept All</button>
        <button class="hunk-btn reject-btn reject-all-btn" title="Reject all changes in this file">&#x2715; Reject All</button>
      `;

      fileControls.querySelector('.accept-all-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onAcceptAll();
      });

      fileControls.querySelector('.reject-all-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onRejectAll(filename);
      });

      fileHeader.after(fileControls);
    }

    // --- Per-hunk controls ---
    // Parse hunk patches from the fileDiff string for reject operations
    const hunkPatches = this.extractHunkPatches(fileDiff);

    const hunkInfoRows = container.querySelectorAll<HTMLElement>('.d2h-info');
    hunkInfoRows.forEach((infoRow, hunkIndex) => {
      const controls = document.createElement('div');
      controls.className = 'hunk-controls';
      controls.dataset['hunkIndex'] = String(hunkIndex);

      const isAccepted = this.acceptedHunks.has(hunkIndex);
      controls.innerHTML = `
        <span class="hunk-label">Hunk ${hunkIndex + 1}</span>
        <button class="hunk-btn accept-btn${isAccepted ? ' active' : ''}"
          data-hunk="${hunkIndex}"
          title="Accept this hunk (keep changes)">
          &#x2713; Accept
        </button>
        <button class="hunk-btn reject-btn"
          data-hunk="${hunkIndex}"
          title="Reject this hunk (revert changes via git)">
          &#x2715; Reject
        </button>
      `;

      controls.querySelector('.accept-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onAcceptHunk(hunkIndex, controls);
      });

      controls.querySelector('.reject-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const patchContent = hunkPatches[hunkIndex] ?? '';
        this.onRejectHunk(hunkIndex, patchContent, fileDiff, filename, controls);
      });

      // Insert before the hunk info row
      infoRow.before(controls);
    });
  }

  /**
   * Extract individual hunk patch strings from a single-file diff.
   * Each entry is a minimal patch that can be applied in reverse to revert that hunk.
   */
  private extractHunkPatches(fileDiff: string): string[] {
    const lines = fileDiff.split('\n');
    const patches: string[] = [];

    // Collect file header lines (before first @@)
    const headerLines: string[] = [];
    let inHeader = true;
    let currentHunkLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('@@')) {
        // Save previous hunk if any
        if (currentHunkLines.length > 0) {
          patches.push([...headerLines, ...currentHunkLines].join('\n'));
        }
        currentHunkLines = [line];
        inHeader = false;
      } else if (inHeader) {
        headerLines.push(line);
      } else {
        currentHunkLines.push(line);
      }
    }

    // Save last hunk
    if (currentHunkLines.length > 0) {
      patches.push([...headerLines, ...currentHunkLines].join('\n'));
    }

    return patches;
  }

  /**
   * Handle accept hunk (visual only — mark with green check overlay).
   */
  onAcceptHunk(hunkIndex: number, controls: HTMLElement): void {
    this.acceptedHunks.add(hunkIndex);
    const btn = controls.querySelector(`.accept-btn[data-hunk="${hunkIndex}"]`) as HTMLButtonElement | null;
    if (btn) {
      btn.classList.add('active');
      btn.textContent = '✓ Accepted';
    }
    // Dim the hunk rows to indicate accepted (visual)
    const hunkInfoRows = this.diffContainer.nativeElement.querySelectorAll<HTMLElement>('.d2h-info');
    if (hunkInfoRows[hunkIndex]) {
      const nextSibling = hunkInfoRows[hunkIndex].nextElementSibling as HTMLElement | null;
      if (nextSibling) {
        nextSibling.style.opacity = '0.5';
      }
    }
  }

  /**
   * Handle accept all hunks (visual only).
   */
  onAcceptAll(): void {
    const hunkInfoRows = this.diffContainer.nativeElement.querySelectorAll<HTMLElement>('.d2h-info');
    hunkInfoRows.forEach((_, i) => {
      this.acceptedHunks.add(i);
    });
    // Update all accept buttons
    this.diffContainer.nativeElement.querySelectorAll<HTMLElement>('.accept-btn').forEach(btn => {
      btn.classList.add('active');
      if (!btn.classList.contains('accept-all-btn')) {
        btn.textContent = '✓ Accepted';
      }
    });
  }

  /**
   * Handle reject hunk — applies patch in reverse via git, shows undo toast.
   */
  async onRejectHunk(
    hunkIndex: number,
    patchContent: string,
    fileDiff: string,
    _filename: string,
    controls: HTMLElement
  ): Promise<void> {
    if (!this.cwd || !patchContent || this.isRejecting) return;

    this.isRejecting = true;
    const rejectBtn = controls.querySelector('.reject-btn') as HTMLButtonElement | null;
    if (rejectBtn) {
      rejectBtn.disabled = true;
      rejectBtn.textContent = '...';
    }

    try {
      const result = await this.codeReviewService.rejectHunk(this.cwd, patchContent);
      if (result.success) {
        // Store forward patch for undo
        this.undoPatchContent = patchContent;
        this.showUndoToast(`Hunk ${hunkIndex + 1} rejected`);
        this.hunkRejected.emit();
      } else {
        console.error('[DiffViewer] rejectHunk failed:', result.error);
        if (rejectBtn) {
          rejectBtn.disabled = false;
          rejectBtn.textContent = '✕ Reject';
        }
      }
    } catch (err: any) {
      console.error('[DiffViewer] rejectHunk error:', err);
      if (rejectBtn) {
        rejectBtn.disabled = false;
        rejectBtn.textContent = '✕ Reject';
      }
    } finally {
      this.isRejecting = false;
    }
  }

  /**
   * Handle reject all — reverts entire file to HEAD via git checkout HEAD -- <file>.
   */
  async onRejectAll(filename: string): Promise<void> {
    if (!this.cwd || !filename || this.isRejecting) return;

    this.isRejecting = true;
    try {
      const result = await this.codeReviewService.rejectFile(this.cwd, filename);
      if (result.success) {
        this.fileRejected.emit();
      } else {
        console.error('[DiffViewer] rejectFile failed:', result.error);
      }
    } catch (err: any) {
      console.error('[DiffViewer] rejectFile error:', err);
    } finally {
      this.isRejecting = false;
    }
  }

  /**
   * Show undo toast for 10 seconds.
   */
  private showUndoToast(message: string): void {
    this.clearUndo();
    this.undoMessage = message;
    this.undoVisible = true;

    this.undoTimeoutId = setTimeout(() => {
      this.undoVisible = false;
      this.undoPatchContent = '';
    }, 10000);
  }

  /**
   * Handle undo button click — re-apply the forward patch to restore changes.
   */
  async onUndo(): Promise<void> {
    if (!this.cwd || !this.undoPatchContent) return;

    this.clearUndo();
    try {
      // Apply forward patch (not reverse) to restore the change
      const result = await this.codeReviewService.applyPatch(this.cwd, this.undoPatchContent);
      if (result.success) {
        this.hunkRejected.emit(); // Re-fetch diff to reflect restored state
      } else {
        console.error('[DiffViewer] undo applyPatch failed:', result.error);
      }
    } catch (err: any) {
      console.error('[DiffViewer] undo error:', err);
    }
  }

  /**
   * Clear the undo toast and timeout.
   */
  private clearUndo(): void {
    if (this.undoTimeoutId !== null) {
      clearTimeout(this.undoTimeoutId);
      this.undoTimeoutId = null;
    }
    this.undoVisible = false;
  }

  /**
   * Toggle file reviewed status.
   */
  onToggleReviewed(): void {
    this.isReviewed = !this.isReviewed;
    const filename = this.file
      ? (this.file.newName !== '/dev/null' ? this.file.newName : this.file.oldName)
      : '';
    this.fileReviewed.emit({ filename, reviewed: this.isReviewed });
  }

  /**
   * Attach click handlers on line number elements for comment placement.
   * Emits lineClicked event with filename and line number.
   */
  private attachLineClickHandlers(file: DiffFile): void {
    const container = this.diffContainer.nativeElement;
    const filename = file.newName !== '/dev/null' ? file.newName : file.oldName;

    // Side-by-side: .d2h-code-side-linenumber
    // Unified: .d2h-code-linenumber
    const selectors = ['.d2h-code-linenumber', '.d2h-code-side-linenumber'];

    selectors.forEach(selector => {
      const lineNumbers = container.querySelectorAll<HTMLElement>(selector);
      lineNumbers.forEach(el => {
        el.style.cursor = 'pointer';
        el.title = 'Click to add comment';

        el.addEventListener('click', (event) => {
          event.stopPropagation();
          const lineNum = parseInt(el.dataset['lineNumber'] ?? el.textContent ?? '0', 10);
          const side = el.classList.contains('d2h-code-old-linenumber') ? 'old' : 'new';
          if (lineNum > 0) {
            this.lineClicked.emit({ filename, line: lineNum, side });
            this.openCommentInput(lineNum, el);
          }
        });
      });
    });
  }

  /**
   * Open the inline comment input near a clicked line.
   */
  private openCommentInput(line: number, lineEl: HTMLElement): void {
    this.commentInputLine = line;
    this.commentInputText = '';
    this.commentInputVisible = true;

    // Position the input after the row containing this line element
    const row = lineEl.closest('tr');
    if (row) {
      // Remove any existing comment input row first
      const existing = this.diffContainer.nativeElement.querySelector('.inline-comment-row');
      if (existing) existing.remove();

      const commentRow = document.createElement('tr');
      commentRow.className = 'inline-comment-row';
      commentRow.innerHTML = `
        <td colspan="10" class="inline-comment-cell">
          <div class="inline-comment-form" id="inline-comment-form-${line}">
            <input
              type="text"
              class="inline-comment-input"
              placeholder="Add comment for line ${line}..."
              id="inline-comment-input-${line}"
            />
            <button class="inline-comment-add" data-line="${line}">Add</button>
            <button class="inline-comment-cancel">Cancel</button>
          </div>
        </td>
      `;

      row.after(commentRow);

      // Focus the input
      setTimeout(() => {
        const input = commentRow.querySelector<HTMLInputElement>('.inline-comment-input');
        if (input) input.focus();

        // Escape closes
        input?.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            commentRow.remove();
            this.closeCommentInput();
          } else if (e.key === 'Enter' && input.value.trim()) {
            this.submitInlineComment(line, input.value.trim(), commentRow);
          }
        });
      }, 10);

      commentRow.querySelector('.inline-comment-add')?.addEventListener('click', () => {
        const input = commentRow.querySelector<HTMLInputElement>('.inline-comment-input');
        if (input?.value.trim()) {
          this.submitInlineComment(line, input.value.trim(), commentRow);
        }
      });

      commentRow.querySelector('.inline-comment-cancel')?.addEventListener('click', () => {
        commentRow.remove();
        this.closeCommentInput();
      });
    }
  }

  private submitInlineComment(line: number, text: string, commentRow: HTMLElement): void {
    commentRow.remove();
    this.commentSubmitted.emit({ line, text });
    this.closeCommentInput();
  }

  closeCommentInput(): void {
    this.commentInputLine = null;
    this.commentInputText = '';
    this.commentInputVisible = false;
    // Remove DOM input row if present
    const existing = this.diffContainer?.nativeElement?.querySelector('.inline-comment-row');
    if (existing) existing.remove();
  }
}
