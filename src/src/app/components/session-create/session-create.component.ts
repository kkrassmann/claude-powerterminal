import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PtyManagerService } from '../../services/pty-manager.service';
import { SessionManagerService } from '../../services/session-manager.service';
import { SessionStateService } from '../../services/session-state.service';
import { TemplateService } from '../../services/template.service';
import { WorktreeService } from '../../services/worktree.service';
import { SessionMetadata } from '../../models/session.model';
import { SessionTemplate, TemplateCategory } from '../../../../shared/template-types';
import { WorktreeInfo } from '../../../../shared/worktree-types';
import { IPC_CHANNELS } from '../../../../shared/ipc-channels';
import { generateRandomBranchName } from '../../utils/random-branch-name';

/**
 * Component for creating new Claude CLI terminal sessions.
 *
 * Provides UI for:
 * - Directory selection (dropdown of recent directories + freetext input)
 * - CLI flag selection (checkboxes for common flags + custom flag input)
 * - Session creation button
 *
 * On creation:
 * 1. Generates unique session ID
 * 2. Spawns PTY process via PtyManagerService
 * 3. Saves session metadata via SessionManagerService
 * 4. Adds to active state via SessionStateService
 *
 * Per Phase 1 CONTEXT.md decisions on session creation UX.
 */
@Component({
  selector: 'app-session-create',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './session-create.component.html',
  styleUrls: ['./session-create.component.css']
})
export class SessionCreateComponent implements OnInit {
  /**
   * Whether the create dialog is open.
   */
  isDialogOpen: boolean = false;

  /**
   * Current working directory for the new session.
   * Can be set via dropdown selection or freetext input.
   */
  workingDirectory: string = '';

  /**
   * List of recently used directories, loaded from localStorage.
   */
  recentDirectories: string[] = [];

  private static readonly RECENT_DIRS_KEY = 'recentDirectories';
  private static readonly MAX_RECENT_DIRS = 10;

  /**
   * Common CLI flags with checkbox toggles.
   * True = flag is enabled, false = disabled.
   */
  selectedFlags: { [key: string]: boolean } = {
    '--verbose': false,
    '--dangerously-skip-permissions': false,
  };

  /**
   * Optional session ID. If empty, a UUID is auto-generated.
   */
  sessionId: string = '';

  /**
   * Freetext input for additional custom flags.
   * Example: "--timeout 60 --model opus"
   */
  customFlags: string = '';

  /**
   * Flag to disable create button during session creation.
   */
  isCreating: boolean = false;

  /**
   * Status message to display after creation attempt.
   */
  statusMessage: string = '';

  /**
   * Type of status message (success/error).
   */
  statusType: 'success' | 'error' | '' = '';

  /**
   * All saved session templates.
   */
  templates: SessionTemplate[] = [];

  /**
   * Currently active category filter. Null means show all.
   */
  activeCategoryFilter: TemplateCategory | null = null;

  /**
   * Available categories for filter pills.
   */
  readonly categories: TemplateCategory[] = ['general', 'bugfix', 'feature', 'review', 'test', 'custom'];

  /**
   * Category color mapping for badges and styling.
   */
  readonly categoryColors: Record<TemplateCategory, string> = {
    general: '#89b4fa',
    bugfix: '#f38ba8',
    feature: '#a6e3a1',
    review: '#fab387',
    test: '#f9e2af',
    custom: '#cba6f7',
  };

  /**
   * Queued initial prompt from a selected template.
   * Will be sent to the PTY after session spawn.
   */
  pendingInitialPrompt: string = '';

  /**
   * Whether the "Save as Template" form is visible.
   */
  showSaveTemplateForm: boolean = false;

  /**
   * Template name for the "Save as Template" form.
   */
  templateName: string = '';

  /**
   * Template description for the "Save as Template" form.
   */
  templateDescription: string = '';

  /**
   * Template category for the "Save as Template" form.
   */
  templateCategory: TemplateCategory = 'general';

  /**
   * Template initial prompt for the "Save as Template" form.
   */
  templateInitialPrompt: string = '';

  // --- Git worktree state ---

  /** Whether the selected directory is a git repository. */
  isGitRepo = false;

  /** Current branch of the selected directory. */
  currentBranch = '';

  /** Existing worktrees for the selected directory. */
  worktrees: WorktreeInfo[] = [];

  /** Available branches for branch picker. */
  branches: string[] = [];

  /** Selected worktree mode. */
  worktreeMode: 'root' | 'existing-worktree' | 'existing-branch' | 'new-branch' = 'root';

  /** Path of selected existing worktree. */
  selectedWorktreePath = '';

  /** Selected existing branch for worktree creation. */
  selectedBranch = '';

  /** Name for new branch. */
  newBranchName = '';

  /** Whether git detection is in progress. */
  checkingGit = false;

  constructor(
    private ptyManager: PtyManagerService,
    private sessionManager: SessionManagerService,
    private sessionState: SessionStateService,
    private templateService: TemplateService,
    private worktreeService: WorktreeService
  ) {
    this.loadRecentDirectories();
  }

  ngOnInit(): void {
    this.loadTemplates();
  }

  /**
   * Generate a UUID v4, with fallback for insecure contexts (HTTP).
   *
   * crypto.randomUUID() requires secure context (HTTPS or localhost).
   * For remote HTTP browsers, use crypto.getRandomValues() which works in all contexts.
   *
   * @returns RFC 4122 version 4 UUID string
   */
  private generateUUID(): string {
    // Try native crypto.randomUUID first (HTTPS or localhost)
    if (crypto.randomUUID) {
      return crypto.randomUUID();
    }

    // Fallback for HTTP contexts: use crypto.getRandomValues
    // Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);

    // Set version (4) and variant bits
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10

    // Convert to hex string with dashes
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }

  /**
   * Set working directory from dropdown selection.
   *
   * @param dir - Directory path from dropdown
   */
  onDirectorySelect(dir: string): void {
    this.workingDirectory = dir;
    this.checkGitRepo(dir);
  }

  /**
   * Called on directory input blur to trigger git check for manually typed paths.
   */
  onDirectoryInputBlur(): void {
    if (this.workingDirectory.trim()) {
      this.checkGitRepo(this.workingDirectory.trim());
    }
  }

  /**
   * Check if a directory is a git repository and load worktrees + branches.
   */
  async checkGitRepo(dir: string): Promise<void> {
    if (!dir.trim()) {
      this.resetGitState();
      return;
    }

    this.checkingGit = true;

    try {
      // Check git context
      let gitContext: { isGitRepo: boolean; branch: string | null };
      if (window.electronAPI) {
        gitContext = await window.electronAPI.invoke(IPC_CHANNELS.GIT_CONTEXT, dir);
      } else {
        const resp = await fetch(`http://${window.location.hostname}:9801/api/git-context?cwd=${encodeURIComponent(dir)}`);
        gitContext = await resp.json();
      }

      if (!gitContext.isGitRepo) {
        this.resetGitState();
        return;
      }

      this.isGitRepo = true;
      this.currentBranch = gitContext.branch || 'unknown';

      // Load worktrees and branches in parallel
      const [worktrees, branchData] = await Promise.all([
        this.worktreeService.listWorktrees(dir),
        this.worktreeService.listBranches(dir),
      ]);

      this.worktrees = worktrees.filter(w => !w.isMain); // exclude main worktree (that's "root")
      this.branches = branchData.local.filter(b => b !== this.currentBranch);
      this.selectedBranch = this.branches[0] || '';
      this.newBranchName = generateRandomBranchName();
    } catch {
      this.resetGitState();
    } finally {
      this.checkingGit = false;
    }
  }

  /** Generate a new random branch name for the input field. */
  rollNewBranchName(): void {
    this.newBranchName = generateRandomBranchName();
  }

  /** Delete a worktree after confirmation. */
  async deleteWorktree(event: Event, wt: WorktreeInfo): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    if (!confirm(`Delete worktree "${wt.branch}" at ${wt.path}?`)) return;
    try {
      await this.worktreeService.deleteWorktree(wt.path, this.workingDirectory);
      this.worktrees = this.worktrees.filter(w => w.path !== wt.path);
      if (this.selectedWorktreePath === wt.path) {
        this.selectedWorktreePath = '';
        this.worktreeMode = 'root';
      }
    } catch (error) {
      this.showError(`Failed to delete worktree: ${error}`);
    }
  }

  private resetGitState(): void {
    this.isGitRepo = false;
    this.currentBranch = '';
    this.worktrees = [];
    this.branches = [];
    this.worktreeMode = 'root';
    this.selectedWorktreePath = '';
    this.selectedBranch = '';
    this.newBranchName = '';
    this.checkingGit = false;
  }

  /**
   * Create a new Claude CLI session.
   *
   * Flow:
   * 1. Generate unique session ID (UUID)
   * 2. Combine selected flags + parse custom flags
   * 3. Create SessionMetadata object
   * 4. Spawn PTY process via IPC
   * 5. Save session metadata to disk
   * 6. Add to active session state
   * 7. Clear form and show success feedback
   *
   * Error handling: Shows error message and logs to console if any step fails.
   */
  async createSession(): Promise<void> {
    // Validation
    if (!this.workingDirectory.trim()) {
      this.showError('Please enter a working directory');
      return;
    }

    this.isCreating = true;
    this.statusMessage = '';
    this.statusType = '';

    try {
      // Step 1: Use provided session ID or generate UUID
      const sessionId = this.sessionId.trim() || this.generateUUID();

      // Step 2: Combine flags
      const flags = this.combineFlags();

      // Step 2.5: Determine effective working directory (may involve worktree creation)
      let effectiveCwd = this.workingDirectory;

      if (this.isGitRepo) {
        if (this.worktreeMode === 'existing-worktree' && this.selectedWorktreePath) {
          effectiveCwd = this.selectedWorktreePath;
        } else if (this.worktreeMode === 'existing-branch' && this.selectedBranch) {
          const wt = await this.worktreeService.createWorktree({
            repoPath: this.workingDirectory,
            branchName: this.selectedBranch,
            useExistingBranch: true,
          });
          if (!wt) throw new Error('Failed to create worktree from existing branch');
          effectiveCwd = wt.path;
        } else if (this.worktreeMode === 'new-branch' && this.newBranchName.trim()) {
          const wt = await this.worktreeService.createWorktree({
            repoPath: this.workingDirectory,
            branchName: this.newBranchName.trim(),
          });
          if (!wt) throw new Error('Failed to create worktree with new branch');
          effectiveCwd = wt.path;
        }
        // 'root' mode: keep workingDirectory as-is
      }

      // Step 3: Create session metadata
      const metadata: SessionMetadata = {
        sessionId,
        workingDirectory: effectiveCwd,
        cliFlags: flags,
        createdAt: new Date().toISOString()
      };

      // Step 4: Spawn PTY process (resume if user provided a session ID)
      const spawnResult = await this.ptyManager.spawnSession({
        sessionId,
        cwd: effectiveCwd,
        flags,
        resume: !!this.sessionId.trim()
      });

      if (!spawnResult.success) {
        throw new Error(`Failed to spawn PTY: ${spawnResult.error || 'Unknown error'}`);
      }

      const pid = spawnResult.pid!;

      // Step 5: Save session metadata to disk
      await this.sessionManager.saveSession(metadata);

      // Step 6: Add to active session state
      this.sessionState.addSession(metadata, pid);

      // Capture prompt before clearing form
      const initialPrompt = this.pendingInitialPrompt;
      const cwd = this.workingDirectory;

      // Step 7: Save directory to recent list, clear form, close dialog
      this.saveRecentDirectory(this.workingDirectory);
      this.clearForm();
      this.pendingInitialPrompt = '';
      this.isDialogOpen = false;

      // Send initial prompt if queued from a template
      if (initialPrompt) {
        // Small delay to let the PTY initialize before sending the prompt
        setTimeout(async () => {
          await this.ptyManager.writeToSession(sessionId, initialPrompt + '\n');
        }, 2000);
      }

      console.log(`Session created: ${sessionId} at ${cwd} with PID ${pid}`);
    } catch (error) {
      console.error('Failed to create session:', error);
      this.showError(`Failed to create session: ${error}`);
    } finally {
      this.isCreating = false;
    }
  }

  /**
   * Load templates from storage.
   */
  async loadTemplates(): Promise<void> {
    this.templates = await this.templateService.listTemplates();
  }

  /**
   * Get templates filtered by the active category filter.
   */
  get filteredTemplates(): SessionTemplate[] {
    if (!this.activeCategoryFilter) {
      return this.templates;
    }
    return this.templates.filter(t => t.category === this.activeCategoryFilter);
  }

  /**
   * Set the category filter.
   */
  setCategoryFilter(category: TemplateCategory | null): void {
    this.activeCategoryFilter =
      this.activeCategoryFilter === category ? null : category;
  }

  /**
   * Apply a template: pre-fill working directory and queue the initial prompt.
   */
  async applyTemplate(template: SessionTemplate): Promise<void> {
    this.workingDirectory = template.workingDirectory;
    this.pendingInitialPrompt = template.initialPrompt || '';

    // Restore CLI flags from template
    if (template.cliFlags?.length) {
      // Reset checkboxes
      for (const key of Object.keys(this.selectedFlags)) {
        this.selectedFlags[key] = template.cliFlags.includes(key);
      }
      // Put non-checkbox flags into customFlags
      const knownFlags = new Set(Object.keys(this.selectedFlags));
      this.customFlags = template.cliFlags.filter(f => !knownFlags.has(f)).join(' ');
    }

    await this.templateService.useTemplate(template);
    await this.loadTemplates();

    // Check git repo for the template's working directory
    this.checkGitRepo(template.workingDirectory);
  }

  /**
   * Save current form values as a new template.
   */
  async saveAsTemplate(): Promise<void> {
    if (!this.templateName.trim()) {
      this.showError('Please enter a template name');
      return;
    }

    if (!this.workingDirectory.trim()) {
      this.showError('Please enter a working directory before saving as template');
      return;
    }

    const template: SessionTemplate = {
      id: this.generateUUID(),
      name: this.templateName.trim(),
      category: this.templateCategory,
      workingDirectory: this.workingDirectory.trim(),
      cliFlags: this.combineFlags(),
      initialPrompt: this.templateInitialPrompt.trim() || undefined,
      description: this.templateDescription.trim() || undefined,
      createdAt: new Date().toISOString(),
      useCount: 0,
    };

    try {
      await this.templateService.saveTemplate(template);
      await this.loadTemplates();
      this.showSaveTemplateForm = false;
      this.templateName = '';
      this.templateDescription = '';
      this.templateCategory = 'general';
      this.templateInitialPrompt = '';
    } catch (error) {
      this.showError(`Failed to save template: ${error}`);
    }
  }

  /**
   * Delete a template by ID.
   */
  async deleteTemplate(event: Event, templateId: string): Promise<void> {
    event.stopPropagation();
    try {
      await this.templateService.deleteTemplate(templateId);
      await this.loadTemplates();
    } catch (error) {
      this.showError(`Failed to delete template: ${error}`);
    }
  }

  /**
   * Combine selected checkbox flags and custom flags into a single array.
   *
   * @returns Array of CLI flags to pass to Claude CLI
   */
  private combineFlags(): string[] {
    const flags: string[] = [];

    // Add checked flags
    Object.entries(this.selectedFlags).forEach(([flag, enabled]) => {
      if (enabled) {
        flags.push(flag);
      }
    });

    // Parse custom flags (split by whitespace)
    if (this.customFlags.trim()) {
      const customFlagsArray = this.customFlags
        .trim()
        .split(/\s+/)
        .filter(f => f.length > 0);

      flags.push(...customFlagsArray);
    }

    return flags;
  }

  /**
   * Clear the form after successful session creation.
   */
  private clearForm(): void {
    this.workingDirectory = '';
    this.sessionId = '';
    this.selectedFlags = {
      '--verbose': false,
      '--dangerously-skip-permissions': false,
    };
    this.customFlags = '';
    this.resetGitState();
  }

  /**
   * Show success message.
   *
   * @param message - Success message to display
   */
  private showSuccess(message: string): void {
    this.statusMessage = message;
    this.statusType = 'success';

    // Auto-hide after 5 seconds
    setTimeout(() => {
      if (this.statusType === 'success') {
        this.statusMessage = '';
        this.statusType = '';
      }
    }, 5000);
  }

  /**
   * Show error message.
   *
   * @param message - Error message to display
   */
  private showError(message: string): void {
    this.statusMessage = message;
    this.statusType = 'error';
  }

  /**
   * Get object keys for *ngFor in template.
   * Helper for iterating over selectedFlags object.
   *
   * @param obj - Object to get keys from
   * @returns Array of object keys
   */
  objectKeys(obj: any): string[] {
    return Object.keys(obj);
  }

  private loadRecentDirectories(): void {
    try {
      const stored = localStorage.getItem(SessionCreateComponent.RECENT_DIRS_KEY);
      this.recentDirectories = stored ? JSON.parse(stored) : [];
    } catch {
      this.recentDirectories = [];
    }
  }

  private saveRecentDirectory(dir: string): void {
    const normalized = dir.trim();
    if (!normalized) return;

    // Move to front, remove duplicates, cap at max
    const dirs = [normalized, ...this.recentDirectories.filter(d => d !== normalized)]
      .slice(0, SessionCreateComponent.MAX_RECENT_DIRS);

    this.recentDirectories = dirs;
    localStorage.setItem(SessionCreateComponent.RECENT_DIRS_KEY, JSON.stringify(dirs));
  }
}
