import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { SessionCreateComponent } from './components/session-create/session-create.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { AnalysisPanelComponent } from './components/analysis-panel/analysis-panel.component';
import { SessionDetailComponent } from './components/session-detail/session-detail.component';
import { CodeReviewPanelComponent } from './components/code-review/code-review-panel.component';
import { SessionStateService } from './services/session-state.service';
import { SessionManagerService } from './services/session-manager.service';
import { PtyManagerService } from './services/pty-manager.service';
import { WorktreeService } from './services/worktree.service';
import { SessionMetadata } from './models/session.model';
import { SpawnSessionRequest } from './models/spawn-session.model';
import { getHttpBaseUrl } from '../../shared/ws-protocol';
import { AudioAlertService } from './services/audio-alert.service';
import { GroupService } from './services/group.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SessionCreateComponent, DashboardComponent, AnalysisPanelComponent, SessionDetailComponent, CodeReviewPanelComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  title = 'Claude PowerTerminal';
  pendingSessions: SessionMetadata[] = [];
  lanUrl: string | null = null;
  showAnalysis = false;
  appBranch: string | null = null;

  /** ID of the session whose detail panel is currently open, or null if closed. */
  selectedSessionId: string | null = null;

  /** Session ID for the currently open code review panel, or null if closed. */
  reviewSessionId: string | null = null;
  /** Working directory for the currently open code review panel. */
  reviewCwd: string | null = null;

  constructor(
    private sessionStateService: SessionStateService,
    private sessionManager: SessionManagerService,
    private ptyManager: PtyManagerService,
    private worktreeService: WorktreeService,
    public audioAlertService: AudioAlertService,
    private groupService: GroupService
  ) {}

  ngOnInit(): void {
    // Fetch app git branch via HTTP
    fetch(`${getHttpBaseUrl()}/api/app/git-branch`)
      .then(r => r.json())
      .then((result: { branch: string | null }) => { this.appBranch = result.branch; })
      .catch(() => {});

    // Step 1: Show pending placeholders FIRST, then start resolving
    this.sessionManager.loadSessions().then(saved => {
      if (saved.length > 0) {
        this.pendingSessions = saved;
        console.log(`[App] Showing ${saved.length} session(s) as resuming`);
      }
      // Step 2: Only after placeholders are rendered, start checking for active PTYs
      setTimeout(() => this.loadRestoredSessions(), 100);
    });

    // Retry loading at intervals to handle timing issues with auto-restore
    const retryInterval = setInterval(() => {
      this.loadRestoredSessions().then(loaded => {
        if (loaded > 0) clearInterval(retryInterval);
      });
    }, 3000);
    setTimeout(() => clearInterval(retryInterval), 30000);

    // Poll for session updates (keeps UI in sync with server state)
    setInterval(() => {
      this.loadRemoteSessions();
    }, 5000);
  }

  onSessionExited(sessionId: string): void {
    this.sessionStateService.removeSession(sessionId);
  }

  /**
   * Toggle session detail panel — clicking the same session again closes it.
   */
  onSessionSelected(sessionId: string): void {
    this.selectedSessionId = sessionId === this.selectedSessionId ? null : sessionId;
  }

  /**
   * Close the session detail panel.
   */
  closeSessionDetail(): void {
    this.selectedSessionId = null;
  }

  /**
   * Get unique working directories of all active sessions for the audit dropdown.
   */
  get activeSessionPaths(): string[] {
    const paths = this.sessionStateService.getAllSessions()
      .map(s => s.metadata.workingDirectory)
      .filter(Boolean);
    return [...new Set(paths)];
  }

  /**
   * Open the code review panel for a session.
   */
  onReviewChanges(event: { sessionId: string; cwd: string }): void {
    this.reviewSessionId = event.sessionId;
    this.reviewCwd = event.cwd;
  }

  /**
   * Close the code review panel.
   */
  closeReview(): void {
    this.reviewSessionId = null;
    this.reviewCwd = null;
  }

  async exportLogs(): Promise<void> {
    try {
      const resp = await fetch(`${getHttpBaseUrl()}/api/logs`);
      const jsonl = await resp.text();

      // Trigger browser download
      const blob = new Blob([jsonl], { type: 'application/x-ndjson' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cpt-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[App] Failed to export logs:', err);
    }
  }

  async refreshApp(): Promise<void> {
    this.pendingSessions = [];
    await this.loadRestoredSessions();
  }

  /**
   * Handle spawn request from tile-header → dashboard.
   * Creates worktree if needed, then spawns a new terminal session.
   */
  async onSpawnNewSession(request: SpawnSessionRequest): Promise<void> {
    const sessionId = crypto.randomUUID
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')
          .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');

    let effectiveCwd = request.cwd;

    try {
      if (request.type === 'existing-worktree' && request.worktreePath) {
        effectiveCwd = request.worktreePath;
      } else if (request.type === 'new-worktree' && request.branchName) {
        const wt = await this.worktreeService.createWorktree({
          repoPath: request.cwd,
          branchName: request.branchName,
          useExistingBranch: request.useExistingBranch,
        });
        if (!wt) {
          console.error('[App] Failed to create worktree for spawn request');
          return;
        }
        effectiveCwd = wt.path;
      }

      const metadata: SessionMetadata = {
        sessionId,
        workingDirectory: effectiveCwd,
        cliFlags: [],
        createdAt: new Date().toISOString(),
      };

      const result = await this.ptyManager.spawnSession({
        sessionId,
        cwd: effectiveCwd,
        flags: [],
      });

      if (!result.success) {
        console.error('[App] Failed to spawn session:', result.error);
        return;
      }

      await this.sessionManager.saveSession(metadata);
      this.sessionStateService.addSession(metadata, result.pid!);

      // Auto-assign to active group if one is selected
      const layout = this.groupService.activeLayout$.value;
      if (layout.activeGroup) {
        this.groupService.addToGroup(sessionId, layout.activeGroup);
      }

      console.log(`[App] Spawned session ${sessionId} in ${effectiveCwd}`);
    } catch (error) {
      console.error('[App] Failed to spawn session:', error);
    }
  }

  private async loadRestoredSessions(): Promise<number> {
    return this.loadRemoteSessions();
  }

  private async loadRemoteSessions(): Promise<number> {
    try {
      const resp = await fetch(`${getHttpBaseUrl()}/api/sessions`);
      const activePtys: { sessionId: string; pid: number; workingDirectory?: string }[] = await resp.json();
      let added = 0;

      const remoteIds = new Set(activePtys.map(p => p.sessionId));

      // Add new sessions
      for (const pty of activePtys) {
        if (!this.sessionStateService.hasSession(pty.sessionId)) {
          this.sessionStateService.addSession({
            sessionId: pty.sessionId,
            workingDirectory: pty.workingDirectory || '',
            cliFlags: [],
            createdAt: new Date().toISOString(),
          }, pty.pid);
          added++;
        }
      }

      // Remove sessions no longer on server
      for (const session of this.sessionStateService.getAllSessions()) {
        if (!remoteIds.has(session.metadata.sessionId)) {
          this.sessionStateService.removeSession(session.metadata.sessionId);
        }
      }

      if (added > 0) {
        console.log(`[App] Remote: loaded ${added} session(s) via HTTP API`);
      }
      return added;
    } catch (error) {
      console.error('[App] Failed to load remote sessions:', error);
      return 0;
    }
  }
}
