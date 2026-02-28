import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WorktreeService } from '../../services/worktree.service';
import { WorktreeInfo, WorktreeCreateOptions } from '../../../../shared/worktree-types';

/**
 * Panel component for managing Git worktrees.
 *
 * Features:
 * - Lists all worktrees for a given repository path
 * - Create new worktrees with a new branch
 * - Delete non-main worktrees
 * - Open a new terminal session in a worktree directory
 * - Shows active session indicator per worktree
 */
@Component({
  selector: 'app-worktree-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './worktree-manager.component.html',
  styleUrls: ['./worktree-manager.component.css']
})
export class WorktreeManagerComponent {
  /**
   * Repository path to list worktrees for.
   * When set, automatically refreshes the worktree list.
   */
  @Input()
  set repoPath(value: string) {
    this._repoPath = value;
    if (value) {
      this.refresh();
    }
  }
  get repoPath(): string {
    return this._repoPath;
  }
  private _repoPath = '';

  /**
   * Emitted when the user clicks "Open Session" on a worktree.
   * The parent component handles creating the terminal session.
   */
  @Output() openSession = new EventEmitter<string>();

  /** List of worktrees for the current repo. */
  worktrees: WorktreeInfo[] = [];

  /** Whether we're currently loading worktrees. */
  loading = false;

  /** Error message to display. */
  errorMessage = '';

  /** Whether the create form is visible. */
  showCreateForm = false;

  /** New branch name input. */
  newBranchName = '';

  /** Base branch input (optional). */
  newBaseBranch = '';

  /** Whether a create operation is in progress. */
  creating = false;

  constructor(private worktreeService: WorktreeService) {}

  /**
   * Refresh the worktree list from the backend.
   */
  async refresh(): Promise<void> {
    if (!this._repoPath) return;

    this.loading = true;
    this.errorMessage = '';

    try {
      this.worktrees = await this.worktreeService.listWorktrees(this._repoPath);
    } catch (error: any) {
      this.errorMessage = error.message || 'Failed to load worktrees';
    } finally {
      this.loading = false;
    }
  }

  /**
   * Create a new worktree with the specified branch name.
   */
  async createWorktree(): Promise<void> {
    if (!this.newBranchName.trim()) return;

    this.creating = true;
    this.errorMessage = '';

    try {
      const options: WorktreeCreateOptions = {
        repoPath: this._repoPath,
        branchName: this.newBranchName.trim(),
      };
      if (this.newBaseBranch.trim()) {
        options.baseBranch = this.newBaseBranch.trim();
      }

      await this.worktreeService.createWorktree(options);
      this.newBranchName = '';
      this.newBaseBranch = '';
      this.showCreateForm = false;
      await this.refresh();
    } catch (error: any) {
      this.errorMessage = error.message || 'Failed to create worktree';
    } finally {
      this.creating = false;
    }
  }

  /**
   * Delete a worktree after confirmation.
   */
  async deleteWorktree(wt: WorktreeInfo): Promise<void> {
    this.errorMessage = '';

    try {
      await this.worktreeService.deleteWorktree(wt.path);
      await this.refresh();
    } catch (error: any) {
      this.errorMessage = error.message || 'Failed to delete worktree';
    }
  }

  /**
   * Emit openSession event for the worktree's directory.
   */
  onOpenSession(wt: WorktreeInfo): void {
    this.openSession.emit(wt.path);
  }

  /**
   * Shorten a path for display by showing only the last 2 segments.
   */
  shortenPath(fullPath: string): string {
    const parts = fullPath.replace(/\\/g, '/').split('/');
    if (parts.length <= 2) return fullPath;
    return '.../' + parts.slice(-2).join('/');
  }
}
