import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { GitContext } from '../models/git-context.model';
import { IPC_CHANNELS } from '../../../shared/ipc-channels';

/**
 * Service for polling Git repository context for tracked terminal sessions.
 *
 * Polls git information every 30 seconds for all tracked sessions, providing
 * branch name and change counts for display in terminal tile headers.
 *
 * Features:
 * - Tracks sessions by sessionId → cwd mapping
 * - Detects count changes for highlight animation triggers
 * - Silent failure on individual session poll errors (keeps previous value)
 * - Automatic cleanup on service destroy
 */
@Injectable({
  providedIn: 'root'
})
export class GitContextService implements OnDestroy {
  /**
   * Map of sessionId → GitContext.
   * Emitted as BehaviorSubject for reactive subscription by components.
   */
  private contexts = new BehaviorSubject<Map<string, GitContext>>(new Map());

  /**
   * Observable of Git contexts for all tracked sessions.
   * Components subscribe to this for reactive updates.
   */
  public contexts$: Observable<Map<string, GitContext>> = this.contexts.asObservable();

  /**
   * Interval handle for 30-second polling.
   * Null when not polling.
   */
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Map of sessionId → cwd for tracked sessions.
   */
  private trackedSessions = new Map<string, string>();

  /**
   * Map of sessionId → serialized change counts (format: "added:modified:deleted").
   * Used to detect count changes for highlight animations.
   */
  private previousCounts = new Map<string, string>();

  /**
   * Set of session IDs that had count changes on the last poll.
   * Components can check this to trigger highlight animations.
   * Automatically cleared 1500ms after poll completes.
   */
  public changedSessions = new Set<string>();

  constructor() {}

  /**
   * Start polling Git context for all tracked sessions.
   * Polls immediately, then every 30 seconds.
   * Safe to call multiple times (no-op if already polling).
   */
  startPolling(): void {
    if (this.pollInterval !== null) {
      console.warn('[GitContextService] Already polling, ignoring startPolling call');
      return;
    }

    console.log('[GitContextService] Starting 30-second polling');
    this.pollAll(); // Poll immediately on start
    this.pollInterval = setInterval(() => this.pollAll(), 30000);
  }

  /**
   * Stop polling Git context.
   * Safe to call multiple times (no-op if not polling).
   */
  stopPolling(): void {
    if (this.pollInterval !== null) {
      console.log('[GitContextService] Stopping polling');
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Add a session to the tracked sessions list and trigger immediate poll for it.
   *
   * @param sessionId - Unique session identifier
   * @param cwd - Working directory for this session
   */
  trackSession(sessionId: string, cwd: string): void {
    console.log(`[GitContextService] Tracking session ${sessionId} in ${cwd}`);
    this.trackedSessions.set(sessionId, cwd);
    this.pollSingleSession(sessionId, cwd); // Immediate poll for new session
  }

  /**
   * Remove a session from tracking and clear its context.
   *
   * @param sessionId - Unique session identifier to untrack
   */
  untrackSession(sessionId: string): void {
    console.log(`[GitContextService] Untracking session ${sessionId}`);
    this.trackedSessions.delete(sessionId);
    this.previousCounts.delete(sessionId);

    // Remove from contexts map and emit updated map
    const currentContexts = this.contexts.value;
    currentContexts.delete(sessionId);
    this.contexts.next(new Map(currentContexts)); // Clone to trigger change detection
  }

  /**
   * Get the current Git context for a session (synchronous).
   *
   * @param sessionId - Unique session identifier
   * @returns GitContext if session is tracked, undefined otherwise
   */
  getContext(sessionId: string): GitContext | undefined {
    return this.contexts.value.get(sessionId);
  }

  /**
   * Poll all tracked sessions for Git context updates.
   * Runs in parallel for all sessions.
   * Updates contexts BehaviorSubject on completion.
   * Detects count changes and triggers changedSessions highlighting.
   */
  private async pollAll(): Promise<void> {
    if (this.trackedSessions.size === 0) {
      return; // No sessions to poll
    }

    console.debug(`[GitContextService] Polling ${this.trackedSessions.size} sessions`);

    // Poll all sessions in parallel
    const pollPromises = Array.from(this.trackedSessions.entries()).map(([sessionId, cwd]) =>
      this.pollSingleSession(sessionId, cwd)
    );

    await Promise.all(pollPromises);

    // Emit updated contexts map
    const currentContexts = this.contexts.value;
    this.contexts.next(new Map(currentContexts)); // Clone to trigger change detection

    // Clear changedSessions after animation duration (1500ms)
    if (this.changedSessions.size > 0) {
      setTimeout(() => {
        this.changedSessions.clear();
      }, 1500);
    }
  }

  /**
   * Poll a single session for Git context.
   * Updates contexts map and detects count changes.
   * Silent failure on errors (logs warning, keeps previous value).
   *
   * @param sessionId - Unique session identifier
   * @param cwd - Working directory for this session
   */
  private async pollSingleSession(sessionId: string, cwd: string): Promise<void> {
    try {
      if (!window.electronAPI) return;
      const context = await window.electronAPI.invoke(IPC_CHANNELS.GIT_CONTEXT, cwd);

      // Update contexts map
      const currentContexts = this.contexts.value;
      currentContexts.set(sessionId, context);

      // Detect count changes for highlight animation
      const currentCounts = `${context.added}:${context.modified}:${context.deleted}`;
      const previousCounts = this.previousCounts.get(sessionId);

      if (previousCounts !== undefined && previousCounts !== currentCounts) {
        console.debug(`[GitContextService] Count change detected for ${sessionId}: ${previousCounts} → ${currentCounts}`);
        this.changedSessions.add(sessionId);
      }

      this.previousCounts.set(sessionId, currentCounts);
    } catch (error: any) {
      console.warn(`[GitContextService] Failed to poll session ${sessionId}:`, error.message);
      // Keep previous value (silent failure)
    }
  }

  /**
   * Cleanup on service destroy.
   * Stops polling to prevent memory leaks.
   */
  ngOnDestroy(): void {
    console.log('[GitContextService] Service destroyed, stopping polling');
    this.stopPolling();
  }
}
