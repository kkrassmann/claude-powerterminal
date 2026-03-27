import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { parse as parseDiff } from 'diff2html';
import type { DiffFile } from 'diff2html/lib/types';
import { CodeReviewService } from '../../services/code-review.service';
import { ReviewComment } from '../../models/code-review.model';
import { detectProjectType, sortFilesByLayer } from '../../models/code-review.model';
import { FileTreeComponent } from './file-tree.component';
import { DiffViewerComponent } from './diff-viewer.component';
import { CommentSidebarComponent } from './comment-sidebar.component';
import { getHttpBaseUrl } from '../../../../shared/ws-protocol';

/**
 * Fullscreen overlay for the local code review panel.
 *
 * Orchestrates the file tree, diff viewer, and comment sidebar:
 * - Fetches the full git diff via CodeReviewService.fetchDiff()
 * - Parses with diff2html to get DiffFile[]
 * - Sorts files by architectural layer using detectProjectType() + sortFilesByLayer()
 * - Manages file selection and Prev/Next navigation
 * - Handles loading and error states
 * - Comment management: add, resolve, delete, send to terminal
 * - Closes on Escape key or X button
 */
@Component({
  selector: 'app-code-review-panel',
  standalone: true,
  imports: [CommonModule, FileTreeComponent, DiffViewerComponent, CommentSidebarComponent],
  templateUrl: './code-review-panel.component.html',
  styleUrls: ['./code-review-panel.component.css'],
})
export class CodeReviewPanelComponent implements OnInit {
  @Input() sessionId!: string;
  @Input() cwd!: string;
  @Output() close = new EventEmitter<void>();

  /** Loading state while diff is being fetched */
  loading = true;

  /** Error state if diff fetch fails */
  error: string | null = null;

  /** Raw unified diff string from git */
  rawDiff = '';

  /** Parsed diff files from diff2html */
  files: DiffFile[] = [];

  /** Currently selected file index */
  selectedFileIndex = 0;

  /** Diff output format */
  outputFormat: 'side-by-side' | 'line-by-line' = 'side-by-side';

  /** Set of file indices that have been reviewed */
  reviewedIndices = new Set<number>();

  /** Whether the comment sidebar is shown */
  showCommentSidebar = false;

  constructor(private codeReviewService: CodeReviewService) {}

  async ngOnInit(): Promise<void> {
    await this.loadDiff();
  }

  private async loadDiff(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.rawDiff = await this.codeReviewService.fetchDiff(this.cwd);

      if (!this.rawDiff) {
        this.error = 'No uncommitted changes found in this directory.';
        this.loading = false;
        return;
      }

      // Parse with diff2html
      const parsed = parseDiff(this.rawDiff);

      // Detect project type and sort by architectural layer
      const filePaths = parsed.map(f => (f.newName !== '/dev/null' ? f.newName : f.oldName));
      const projectType = detectProjectType(filePaths);
      const sortInput = parsed.map(f => ({
        file: f,
        filename: f.newName !== '/dev/null' ? f.newName : f.oldName,
      }));
      const sortedInput = sortFilesByLayer(sortInput, projectType);
      this.files = sortedInput.map(s => s.file);

      this.selectedFileIndex = 0;
    } catch (err: any) {
      this.error = err?.message ?? 'Failed to load diff.';
    } finally {
      this.loading = false;
    }
  }

  get selectedFile(): DiffFile | null {
    return this.files[this.selectedFileIndex] ?? null;
  }

  get currentFilename(): string {
    const f = this.selectedFile;
    if (!f) return '';
    return f.newName !== '/dev/null' ? f.newName : f.oldName;
  }

  get commentsForCurrentFile(): ReviewComment[] {
    if (!this.sessionId || !this.currentFilename) return [];
    return this.codeReviewService.getCommentsForFile(this.sessionId, this.currentFilename);
  }

  prevFile(): void {
    if (this.selectedFileIndex > 0) {
      this.selectedFileIndex--;
    }
  }

  nextFile(): void {
    if (this.selectedFileIndex < this.files.length - 1) {
      this.selectedFileIndex++;
    }
  }

  onFileSelected(index: number): void {
    this.selectedFileIndex = index;
  }

  toggleFormat(): void {
    this.outputFormat = this.outputFormat === 'side-by-side' ? 'line-by-line' : 'side-by-side';
  }

  markReviewed(index: number): void {
    if (this.reviewedIndices.has(index)) {
      this.reviewedIndices.delete(index);
    } else {
      this.reviewedIndices.add(index);
    }
    // Force change detection by replacing the set reference
    this.reviewedIndices = new Set(this.reviewedIndices);
  }

  toggleCommentSidebar(): void {
    this.showCommentSidebar = !this.showCommentSidebar;
  }

  // ---------------------------------------------------------------------------
  // Diff viewer event handlers
  // ---------------------------------------------------------------------------

  /**
   * Handle hunk/file rejected — re-fetch diff so it stays in sync.
   */
  async onHunkRejected(): Promise<void> {
    await this.loadDiff();
  }

  async onFileRejected(): Promise<void> {
    await this.loadDiff();
    // If the current file index is now out of bounds, reset to 0
    if (this.selectedFileIndex >= this.files.length) {
      this.selectedFileIndex = Math.max(0, this.files.length - 1);
    }
  }

  /**
   * Handle file reviewed event from diff viewer.
   */
  onFileReviewedFromViewer(event: { filename: string; reviewed: boolean }): void {
    if (event.reviewed) {
      this.reviewedIndices.add(this.selectedFileIndex);
    } else {
      this.reviewedIndices.delete(this.selectedFileIndex);
    }
    this.reviewedIndices = new Set(this.reviewedIndices);
  }

  /**
   * Handle comment submitted from inline diff input.
   * Adds to service, shows sidebar.
   */
  onCommentSubmitted(event: { line: number; text: string }): void {
    if (!this.sessionId || !this.currentFilename) return;
    this.codeReviewService.addComment(this.sessionId, this.currentFilename, event.line, event.text);
    this.showCommentSidebar = true;
  }

  // ---------------------------------------------------------------------------
  // Comment sidebar event handlers
  // ---------------------------------------------------------------------------

  /**
   * Send a single comment as a prompt to the terminal.
   */
  async onSendNow(comment: ReviewComment): Promise<void> {
    const prompt = `Review-Feedback fuer ${comment.filename}:\n- Zeile ${comment.line}: ${comment.text}\n`;
    await this.writeToTerminal(prompt);
  }

  /**
   * Send all unresolved comments for the current file as a structured prompt.
   */
  async onSendSummary(comments: ReviewComment[]): Promise<void> {
    if (comments.length === 0) return;

    const lines = comments.map(c => `- Zeile ${c.line}: ${c.text}`);
    const prompt = `Review-Feedback fuer ${this.currentFilename}:\n${lines.join('\n')}\n`;
    await this.writeToTerminal(prompt);
  }

  /**
   * Toggle resolved status of a comment.
   */
  onCommentResolved(commentId: string): void {
    if (!this.sessionId) return;
    this.codeReviewService.toggleResolved(this.sessionId, commentId);
  }

  /**
   * Delete a comment.
   */
  onCommentDeleted(commentId: string): void {
    if (!this.sessionId) return;
    this.codeReviewService.removeComment(this.sessionId, commentId);
    // Hide sidebar if no more comments
    if (this.commentsForCurrentFile.length === 0) {
      this.showCommentSidebar = false;
    }
  }

  /**
   * Write a prompt string to the terminal PTY via HTTP API.
   */
  private async writeToTerminal(prompt: string): Promise<void> {
    try {
      await fetch(`${getHttpBaseUrl()}/api/pty/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.sessionId, data: prompt }),
      });
    } catch (err: any) {
      console.error('[CodeReviewPanel] writeToTerminal failed:', err.message);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close.emit();
  }
}
