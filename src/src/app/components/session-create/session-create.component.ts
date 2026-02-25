import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PtyManagerService } from '../../services/pty-manager.service';
import { SessionManagerService } from '../../services/session-manager.service';
import { SessionStateService } from '../../services/session-state.service';
import { SessionMetadata } from '../../models/session.model';

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
export class SessionCreateComponent {
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

  constructor(
    private ptyManager: PtyManagerService,
    private sessionManager: SessionManagerService,
    private sessionState: SessionStateService
  ) {
    this.loadRecentDirectories();
  }

  /**
   * Set working directory from dropdown selection.
   *
   * @param dir - Directory path from dropdown
   */
  onDirectorySelect(dir: string): void {
    this.workingDirectory = dir;
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
      const sessionId = this.sessionId.trim() || crypto.randomUUID();

      // Step 2: Combine flags
      const flags = this.combineFlags();

      // Step 3: Create session metadata
      const metadata: SessionMetadata = {
        sessionId,
        workingDirectory: this.workingDirectory,
        cliFlags: flags,
        createdAt: new Date().toISOString()
      };

      // Step 4: Spawn PTY process (resume if user provided a session ID)
      const spawnResult = await this.ptyManager.spawnSession({
        sessionId,
        cwd: this.workingDirectory,
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

      // Step 7: Save directory to recent list, clear form, close dialog
      this.saveRecentDirectory(this.workingDirectory);
      this.clearForm();
      this.isDialogOpen = false;

      console.log(`✓ Session created: ${sessionId} at ${this.workingDirectory} with PID ${pid}`);
    } catch (error) {
      console.error('Failed to create session:', error);
      this.showError(`Failed to create session: ${error}`);
    } finally {
      this.isCreating = false;
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
