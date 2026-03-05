import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, NgZone, ElementRef, ViewChildren, QueryList } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Subscription, combineLatest } from 'rxjs';
import { SessionStateService, ActiveSession } from '../../services/session-state.service';
import { GitContextService } from '../../services/git-context.service';
import { SessionManagerService } from '../../services/session-manager.service';
import { LogAnalysisService } from '../../services/log-analysis.service';
import { GroupService } from '../../services/group.service';
import { SessionMetadata } from '../../models/session.model';
import { TerminalComponent } from '../terminal/terminal.component';
import { TileHeaderComponent } from '../tile-header/tile-header.component';
import { GroupTabsComponent } from '../group-tabs/group-tabs.component';
import { IPC_CHANNELS } from '../../../../shared/ipc-channels';
import { TerminalStatus } from '../../models/terminal-status.model';
import { AudioAlertService } from '../../services/audio-alert.service';
import type { SessionPracticeScore } from '../../../../shared/analysis-types';
import { LayoutPreset } from '../../../../shared/group-types';
import { SpawnSessionRequest } from '../../models/spawn-session.model';

/**
 * Dashboard grid component for displaying and managing multiple terminal sessions.
 *
 * Features:
 * - Responsive CSS Grid layout with auto-fill columns (min 400px tile width)
 * - CDK drag-drop for tile reordering via header drag handle
 * - Maximize toggle to view single tile in full viewport
 * - Git context integration for each tile header
 * - Pending session placeholders during session restore
 * - Session tracking in git context service
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, DragDropModule, TerminalComponent, TileHeaderComponent, GroupTabsComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit, OnDestroy {
  /**
   * Pending sessions that are being restored (show placeholders).
   * Passed from parent AppComponent during session restoration.
   */
  @Input() pendingSessions: SessionMetadata[] = [];

  /**
   * Emitted when a session exits and should be removed from state.
   */
  @Output() sessionExited = new EventEmitter<string>();

  /**
   * Emitted when a session score chip is clicked in a tile header.
   * Bubbles the sessionSelected event from TileHeaderComponent up to AppComponent.
   */
  @Output() sessionSelected = new EventEmitter<string>();

  /**
   * Emitted when a tile-header requests spawning a new session (worktree or clone).
   */
  @Output() spawnNewSession = new EventEmitter<SpawnSessionRequest>();

  /**
   * Emitted when the "Review Changes" button is clicked in a tile header.
   * Bubbles the event up to AppComponent.
   */
  @Output() reviewChanges = new EventEmitter<{ sessionId: string; cwd: string }>();

  @ViewChildren(TerminalComponent) terminalComponents!: QueryList<TerminalComponent>;

  /**
   * Active sessions (with live PTY processes and scrollback buffers).
   * Populated from SessionStateService subscription.
   */
  sessions: ActiveSession[] = [];

  /**
   * Sessions filtered by the active group tab.
   * When no group filter is active, this equals all sessions.
   */
  filteredSessions: ActiveSession[] = [];

  /**
   * Active layout preset for CSS grid behavior.
   */
  layoutPreset: LayoutPreset = 'overview';

  /**
   * ID of the currently maximized session, or null if in grid view.
   */
  maximizedSessionId: string | null = null;

  /**
   * User's home directory for path shortening in tile headers.
   */
  homeDir: string = '';

  /** Per-tile heights set by resize. Key = sessionId, value = px. */
  tileHeights: Record<string, number> = {};

  /** Per-tile widths set by resize. Key = sessionId, value = px. */
  tileWidths: Record<string, number> = {};

  /** Per-session practice scores for tile header display. */
  sessionScores: Map<string, SessionPracticeScore> = new Map();

  /** Per-session status tracking for audio alerts and CSS classes. */
  sessionStatuses: Record<string, TerminalStatus> = {};

  /** Whether the glow is active per session (set on genuine alert, cleared on click/WORKING). */
  private glowActive: Record<string, boolean> = {};

  /** Whether this session has ever fired an alert (to allow the first one unconditionally). */
  private hasAlertedOnce: Record<string, boolean> = {};

  /** Whether sustained WORKING (>=3s) occurred since the last alert for this session. */
  private sustainedWorkSinceAlert: Record<string, boolean> = {};

  /** Timestamp when each session entered WORKING state. */
  private workStartTimestamps: Record<string, number> = {};

  /** Minimum WORKING duration (ms) to count as "sustained" (real Claude output, not click noise). */
  private static readonly MIN_SUSTAINED_WORK_MS = 3000;

  /** Whether session restore from main process is complete. Prevents premature group cleanup. */
  private restoreComplete = false;

  private sessionsSubscription: Subscription | null = null;
  private scoreRefreshInterval: ReturnType<typeof setInterval> | null = null;
  private layoutSubscription: Subscription | null = null;

  /** Height resize state */
  private resizing = false;
  private resizeSessionId: string | null = null;
  private resizeStartY = 0;
  private resizeStartHeight = 0;
  private resizeRowSessionIds: string[] = [];
  private boundOnResizeMove: ((e: MouseEvent) => void) | null = null;
  private boundOnResizeEnd: ((e: MouseEvent) => void) | null = null;

  /** Width resize state */
  private widthResizing = false;
  private widthResizeSessionId: string | null = null;
  private widthResizeStartX = 0;
  private widthResizeStartWidth = 0;
  private boundOnWidthResizeMove: ((e: MouseEvent) => void) | null = null;
  private boundOnWidthResizeEnd: ((e: MouseEvent) => void) | null = null;

  constructor(
    private sessionStateService: SessionStateService,
    public gitContextService: GitContextService,
    private sessionManagerService: SessionManagerService,
    private logAnalysisService: LogAnalysisService,
    public groupService: GroupService,
    private ngZone: NgZone,
    private elementRef: ElementRef,
    public audioAlertService: AudioAlertService
  ) {}

  ngOnInit(): void {
    // Subscribe to active sessions + groups + layout combined for filtering
    this.sessionsSubscription = combineLatest([
      this.sessionStateService.sessions$,
      this.groupService.groups$,
      this.groupService.activeLayout$
    ]).subscribe(([sessionsMap, groups, layout]) => {
      this.sessions = Array.from(sessionsMap.values());
      this.layoutPreset = layout.preset;

      // Filter sessions by active group
      if (layout.activeGroup) {
        const group = groups.find(g => g.name === layout.activeGroup);
        if (group) {
          const groupIds = new Set(group.sessionIds);
          this.filteredSessions = this.sessions.filter(
            s => groupIds.has(s.metadata.sessionId)
          );
        } else {
          this.filteredSessions = this.sessions;
        }
      } else {
        this.filteredSessions = this.sessions;
      }

      // Remove pending sessions that became active
      if (this.pendingSessions.length > 0) {
        const activeSessonIds = new Set(this.sessions.map(s => s.metadata.sessionId));
        this.pendingSessions = this.pendingSessions.filter(p => !activeSessonIds.has(p.sessionId));
      }

      // Track/untrack sessions in git context service
      this.updateGitContextTracking();

      // Clean up stale session IDs from groups only after restore is complete —
      // during startup, sessions arrive one by one and premature cleanup would wipe
      // IDs of sessions that haven't been restored yet
      if (this.restoreComplete) {
        const activeIds = new Set(this.sessions.map(s => s.metadata.sessionId));
        this.groupService.cleanupStaleSessionIds(activeIds);
      }
    });

    // Listen for session restore completion to enable group cleanup
    if (window.electronAPI) {
      window.electronAPI.on(IPC_CHANNELS.SESSION_RESTORE_COMPLETE, () => {
        this.restoreComplete = true;
      });
    }
    // Fallback: enable cleanup after 60s even if no restore signal (e.g., 0 saved sessions).
    // Must be long enough for sequential session restoration (N sessions × 3s delay each).
    setTimeout(() => { this.restoreComplete = true; }, 60000);

    // Fetch home directory for path shortening
    this.fetchHomeDir();

    // Start git context polling
    this.gitContextService.startPolling();

    // Load session scores after a short delay (let sessions load first)
    setTimeout(() => this.refreshAllScores(), 3000);

    // Refresh scores every 60 seconds
    this.scoreRefreshInterval = setInterval(() => this.refreshAllScores(), 60000);
  }

  ngOnDestroy(): void {
    // Clean up subscriptions and polling
    this.sessionsSubscription?.unsubscribe();
    this.layoutSubscription?.unsubscribe();
    this.gitContextService.stopPolling();
    if (this.scoreRefreshInterval) {
      clearInterval(this.scoreRefreshInterval);
      this.scoreRefreshInterval = null;
    }
  }

  /**
   * Refresh practice scores for all active sessions.
   * Loads each score in parallel and updates the sessionScores map.
   */
  private async refreshAllScores(): Promise<void> {
    if (this.sessions.length === 0) return;

    const scorePromises = this.sessions.map(async (session) => {
      const score = await this.logAnalysisService.loadSessionScore(session.metadata.sessionId);
      this.sessionScores.set(session.metadata.sessionId, score);
    });

    await Promise.all(scorePromises);
    // Trigger change detection by replacing the map reference
    this.sessionScores = new Map(this.sessionScores);
  }

  /**
   * Get practice score for a session (used in template).
   */
  getSessionScore(sessionId: string): number | null {
    const score = this.sessionScores.get(sessionId);
    return score ? score.score : null;
  }

  /**
   * Get badges for a session (used in template).
   */
  getSessionBadges(sessionId: string): string[] {
    const score = this.sessionScores.get(sessionId);
    return score ? score.badges : [];
  }

  /**
   * Fetch user's home directory from main process.
   */
  private async fetchHomeDir(): Promise<void> {
    try {
      if (!window.electronAPI) {
        this.homeDir = '';
        return;
      }
      this.homeDir = await window.electronAPI.invoke(IPC_CHANNELS.APP_HOME_DIR);
    } catch (error) {
      console.error('[Dashboard] Failed to fetch home directory:', error);
      this.homeDir = '';
    }
  }

  /**
   * Update git context service tracking based on current active sessions.
   * Track new sessions, untrack removed sessions.
   */
  private updateGitContextTracking(): void {
    const currentSessionIds = new Set(this.sessions.map(s => s.metadata.sessionId));
    const trackedSessionIds = new Set(this.gitContextService['trackedSessions'].keys());

    // Track new sessions
    for (const session of this.sessions) {
      if (!trackedSessionIds.has(session.metadata.sessionId)) {
        this.gitContextService.trackSession(session.metadata.sessionId, session.metadata.workingDirectory);
      }
    }

    // Untrack removed sessions
    for (const sessionId of trackedSessionIds) {
      if (!currentSessionIds.has(sessionId)) {
        this.gitContextService.untrackSession(sessionId);
      }
    }
  }

  /**
   * Toggle maximize state for a session.
   * If already maximized, restore to grid view.
   * If not maximized, maximize the specified session.
   *
   * @param sessionId - ID of session to maximize/restore
   */
  toggleMaximize(sessionId: string): void {
    if (this.maximizedSessionId === sessionId) {
      this.maximizedSessionId = null; // Restore to grid
    } else {
      this.maximizedSessionId = sessionId; // Maximize
    }
  }

  /**
   * Get CSS class for layout preset.
   */
  get layoutClass(): string {
    return `layout-${this.layoutPreset}`;
  }

  /**
   * Get group color for a session's left border.
   *
   * @param sessionId - Session to check
   * @returns Hex color string or empty string if not grouped
   */
  getGroupBorderColor(sessionId: string): string {
    const group = this.groupService.getGroupForSession(sessionId);
    return group?.color || '';
  }

  /**
   * Handle native dragstart on a tile (for group tab drop targets).
   */
  onTileDragStart(event: DragEvent, sessionId: string): void {
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', sessionId);
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  /**
   * Handle drag-drop reordering of tiles in grid.
   *
   * @param event - CDK drag-drop event with previous/current indices
   */
  onDrop(event: CdkDragDrop<ActiveSession[]>): void {
    moveItemInArray(this.filteredSessions, event.previousIndex, event.currentIndex);
  }

  /**
   * TrackBy function for *ngFor to optimize rendering.
   *
   * @param index - Array index
   * @param session - ActiveSession item
   * @returns Session ID as unique identifier
   */
  trackBySessionId(index: number, session: ActiveSession): string {
    return session.metadata.sessionId;
  }

  /**
   * Get session by ID (used in maximized view template).
   *
   * @param sessionId - Session ID to retrieve
   * @returns ActiveSession or undefined if not found
   */
  getSession(sessionId: string): ActiveSession | undefined {
    return this.sessions.find(s => s.metadata.sessionId === sessionId);
  }

  /**
   * Handle sessionSelected event from tile-header — bubble up to app component.
   *
   * @param sessionId - ID of the session whose score chip was clicked
   */
  onSessionSelected(sessionId: string): void {
    this.sessionSelected.emit(sessionId);
  }

  /**
   * Relay spawn request from tile-header up to app component.
   */
  onSpawnNewSession(request: SpawnSessionRequest): void {
    this.spawnNewSession.emit(request);
  }

  /**
   * Bubble review changes event from tile-header to app component.
   */
  onReviewChanges(event: { sessionId: string; cwd: string }): void {
    this.reviewChanges.emit(event);
  }

  /**
   * Check if a session has uncommitted git changes.
   */
  hasUncommittedChanges(sessionId: string): boolean {
    const ctx = this.gitContextService.getContext(sessionId);
    if (!ctx) return false;
    return (ctx.added || 0) + (ctx.modified || 0) + (ctx.deleted || 0) > 0;
  }

  /**
   * Handle session exit event from terminal component.
   * Emit to parent AppComponent for cleanup.
   *
   * @param sessionId - ID of exited session
   */
  onSessionExited(sessionId: string): void {
    // If maximized session exited, restore to grid
    if (this.maximizedSessionId === sessionId) {
      this.maximizedSessionId = null;
    }

    // Clean up per-session tracking state
    delete this.sessionStatuses[sessionId];
    delete this.glowActive[sessionId];
    delete this.hasAlertedOnce[sessionId];
    delete this.sustainedWorkSinceAlert[sessionId];
    delete this.workStartTimestamps[sessionId];
    this.groupService.removeFromGroup(sessionId);

    // Emit to parent for state cleanup
    this.sessionExited.emit(sessionId);
  }

  /**
   * Dismiss glow on a tile when the user clicks it (acknowledge).
   */
  onTileClick(sessionId: string): void {
    this.glowActive[sessionId] = false;
  }

  /**
   * Handle status change event from terminal component.
   *
   * Alert logic: Only fire sound+glow on genuine new alerts.
   * A "genuine" alert requires either:
   *   - First alert for this session (no prior alert), OR
   *   - Sustained WORKING (>=3s) since the last alert (real Claude output, not click noise)
   *
   * This prevents re-alerting when the user clicks into a WAITING terminal,
   * which causes a brief WORKING→THINKING→WAITING oscillation.
   */
  onStatusChanged(event: { sessionId: string; status: TerminalStatus }): void {
    const prev = this.sessionStatuses[event.sessionId];
    this.sessionStatuses[event.sessionId] = event.status;
    const sid = event.sessionId;

    // Track when sessions enter WORKING
    if (event.status === 'WORKING' && prev !== 'WORKING') {
      this.workStartTimestamps[sid] = Date.now();
      // Entering WORKING = user interacted or Claude started — dismiss glow
      this.glowActive[sid] = false;
    }

    // When leaving WORKING, check if it was sustained (real work vs click noise)
    if (prev === 'WORKING' && event.status !== 'WORKING') {
      const duration = Date.now() - (this.workStartTimestamps[sid] || Date.now());
      if (duration >= DashboardComponent.MIN_SUSTAINED_WORK_MS) {
        this.sustainedWorkSinceAlert[sid] = true;
      }
    }

    // Alert on transitions to alert-worthy states
    const isAlertWorthy = event.status === 'WAITING' || event.status === 'ERROR' || event.status === 'DONE';
    if (prev !== event.status && isAlertWorthy) {
      const isFirstAlert = !this.hasAlertedOnce[sid];
      const hadRealWork = this.sustainedWorkSinceAlert[sid] === true;

      if (isFirstAlert || hadRealWork) {
        this.audioAlertService.alert(event.status);
        this.glowActive[sid] = true;
        this.hasAlertedOnce[sid] = true;
        this.sustainedWorkSinceAlert[sid] = false;
      }
      // Otherwise: returning to alert state after brief interaction — skip sound+glow
    }
  }

  /**
   * Get CSS class for tile based on current status.
   *
   * @param sessionId - Session ID
   * @returns CSS class name for status
   */
  getStatusClass(sessionId: string): string {
    const status = this.sessionStatuses[sessionId] || 'WORKING';
    // Only show glow when a genuine alert fired (not after brief interaction noise)
    if ((status === 'WAITING' || status === 'ERROR') && !this.glowActive[sessionId]) {
      return 'status-working';
    }
    return `status-${status.toLowerCase()}`;
  }

  /**
   * Restart a session by delegating to the TerminalComponent which handles
   * PTY restart + WebSocket reconnect correctly.
   */
  restartSession(sessionId: string): void {
    const terminal = this.terminalComponents?.find(t => t.sessionId === sessionId);
    if (terminal) {
      terminal.restartSession();
    } else {
      console.error('[Dashboard] Cannot restart: terminal component not found', sessionId);
    }
  }

  /**
   * Kill a session permanently.
   * Directly triggers exit flow after successful kill instead of relying
   * on the WebSocket exit round-trip (which can fail after restarts or on Windows).
   */
  async killSession(sessionId: string): Promise<void> {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.invoke(IPC_CHANNELS.PTY_KILL, sessionId);
      if (result?.success) {
        this.onSessionExited(sessionId);
      }
    } catch (error) {
      console.error('[Dashboard] Failed to kill session:', error);
    }
  }

  /**
   * Start row-based resize. Finds all tiles in the same row and tracks them.
   */
  onResizeStart(event: MouseEvent, sessionId: string): void {
    event.preventDefault();
    event.stopPropagation();

    const tileEl = (event.target as HTMLElement).closest('.tile') as HTMLElement;
    if (!tileEl) return;

    this.resizing = true;
    this.resizeSessionId = sessionId;
    this.resizeStartY = event.clientY;
    this.resizeStartHeight = tileEl.offsetHeight;

    // Find all tiles in the same row (same offsetTop)
    const allTiles = this.elementRef.nativeElement.querySelectorAll('.tile:not(.pending-tile)') as NodeListOf<HTMLElement>;
    const rowTop = tileEl.offsetTop;
    this.resizeRowSessionIds = [];

    allTiles.forEach((el: HTMLElement, i: number) => {
      if (Math.abs(el.offsetTop - rowTop) < 5 && i < this.sessions.length) {
        this.resizeRowSessionIds.push(this.sessions[i].metadata.sessionId);
      }
    });

    // Bind move/end listeners outside Angular zone for performance
    this.boundOnResizeMove = this.onResizeMove.bind(this);
    this.boundOnResizeEnd = this.onResizeEnd.bind(this);

    this.ngZone.runOutsideAngular(() => {
      document.addEventListener('mousemove', this.boundOnResizeMove!);
      document.addEventListener('mouseup', this.boundOnResizeEnd!);
    });

    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }

  private onResizeMove(event: MouseEvent): void {
    if (!this.resizing) return;

    const delta = event.clientY - this.resizeStartY;
    const newHeight = Math.max(200, this.resizeStartHeight + delta);

    // Apply to all tiles in the same row
    this.ngZone.run(() => {
      for (const sid of this.resizeRowSessionIds) {
        this.tileHeights[sid] = newHeight;
      }
    });
  }

  private onResizeEnd(_event: MouseEvent): void {
    this.resizing = false;
    this.resizeSessionId = null;
    this.resizeRowSessionIds = [];

    if (this.boundOnResizeMove) {
      document.removeEventListener('mousemove', this.boundOnResizeMove);
    }
    if (this.boundOnResizeEnd) {
      document.removeEventListener('mouseup', this.boundOnResizeEnd);
    }
    this.boundOnResizeMove = null;
    this.boundOnResizeEnd = null;

    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  /**
   * Start width resize on right edge drag.
   */
  onWidthResizeStart(event: MouseEvent, sessionId: string): void {
    event.preventDefault();
    event.stopPropagation();

    const tileEl = (event.target as HTMLElement).closest('.tile') as HTMLElement;
    if (!tileEl) return;

    this.widthResizing = true;
    this.widthResizeSessionId = sessionId;
    this.widthResizeStartX = event.clientX;
    this.widthResizeStartWidth = tileEl.offsetWidth;

    this.boundOnWidthResizeMove = this.onWidthResizeMove.bind(this);
    this.boundOnWidthResizeEnd = this.onWidthResizeEnd.bind(this);

    this.ngZone.runOutsideAngular(() => {
      document.addEventListener('mousemove', this.boundOnWidthResizeMove!);
      document.addEventListener('mouseup', this.boundOnWidthResizeEnd!);
    });

    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }

  private onWidthResizeMove(event: MouseEvent): void {
    if (!this.widthResizing || !this.widthResizeSessionId) return;

    const delta = event.clientX - this.widthResizeStartX;
    const newWidth = Math.max(300, this.widthResizeStartWidth + delta);

    this.ngZone.run(() => {
      this.tileWidths[this.widthResizeSessionId!] = newWidth;
    });
  }

  private onWidthResizeEnd(_event: MouseEvent): void {
    this.widthResizing = false;
    this.widthResizeSessionId = null;

    if (this.boundOnWidthResizeMove) {
      document.removeEventListener('mousemove', this.boundOnWidthResizeMove);
    }
    if (this.boundOnWidthResizeEnd) {
      document.removeEventListener('mouseup', this.boundOnWidthResizeEnd);
    }
    this.boundOnWidthResizeMove = null;
    this.boundOnWidthResizeEnd = null;

    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
}
