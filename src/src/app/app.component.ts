import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { SessionCreateComponent } from './components/session-create/session-create.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { AnalysisPanelComponent } from './components/analysis-panel/analysis-panel.component';
import { SessionDetailComponent } from './components/session-detail/session-detail.component';
import { SessionStateService } from './services/session-state.service';
import { SessionManagerService } from './services/session-manager.service';
import { SessionMetadata } from './models/session.model';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { AudioAlertService } from './services/audio-alert.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SessionCreateComponent, DashboardComponent, AnalysisPanelComponent, SessionDetailComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  title = 'Claude PowerTerminal';
  pendingSessions: SessionMetadata[] = [];
  lanUrl: string | null = null;
  showAnalysis = false;

  /** ID of the session whose detail panel is currently open, or null if closed. */
  selectedSessionId: string | null = null;

  constructor(
    private sessionStateService: SessionStateService,
    private sessionManager: SessionManagerService,
    public audioAlertService: AudioAlertService
  ) {}

  ngOnInit(): void {
    // Fetch LAN URL if running in Electron
    if (window.electronAPI) {
      window.electronAPI.invoke(IPC_CHANNELS.APP_LAN_URL).then((url: string | null) => {
        this.lanUrl = url;
      }).catch((err: any) => {
        console.error('[App] Failed to fetch LAN URL:', err);
      });
    }

    // Step 1: Show pending placeholders FIRST, then start resolving
    this.sessionManager.loadSessions().then(saved => {
      if (saved.length > 0) {
        this.pendingSessions = saved;
        console.log(`[App] Showing ${saved.length} session(s) as resuming`);
      }
      // Step 2: Only after placeholders are rendered, start checking for active PTYs
      // Small delay so Angular can render the placeholders before they get replaced
      setTimeout(() => this.loadRestoredSessions(), 100);
    });

    // Load restored sessions when main process signals restore is complete (guard electronAPI)
    if (window.electronAPI) {
      window.electronAPI.on(IPC_CHANNELS.SESSION_RESTORE_COMPLETE, () => {
        console.log('[App] Received restore-complete signal');
        this.loadRestoredSessions();
      });
    }

    // Retry loading at intervals to handle timing issues with auto-restore
    const retryInterval = setInterval(() => {
      this.loadRestoredSessions().then(loaded => {
        if (loaded > 0) clearInterval(retryInterval);
      });
    }, 3000);
    setTimeout(() => clearInterval(retryInterval), 30000);

    // Poll for session updates when in remote browser mode
    if (!window.electronAPI) {
      setInterval(() => {
        this.loadRemoteSessions();
      }, 5000); // 5-second polling
    }
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
   * Get the working directory of the currently selected session.
   * Used by the analysis-panel's audit tab to know which project to audit.
   */
  get selectedSessionWorkingDir(): string {
    if (!this.selectedSessionId) return '';
    const session = this.sessionStateService.getSession(this.selectedSessionId);
    return session?.metadata.workingDirectory ?? '';
  }

  async exportLogs(): Promise<void> {
    try {
      let jsonl: string;
      if (window.electronAPI) {
        jsonl = await window.electronAPI.invoke(IPC_CHANNELS.LOGS_EXPORT);
      } else {
        const resp = await fetch(`http://${window.location.hostname}:9801/api/logs`);
        jsonl = await resp.text();
      }

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

  private async loadRestoredSessions(): Promise<number> {
    try {
      // Remote browser: load sessions via HTTP API
      if (!window.electronAPI) {
        return this.loadRemoteSessions();
      }

      const [savedSessions, activePtys] = await Promise.all([
        this.sessionManager.loadSessions(),
        window.electronAPI.invoke(IPC_CHANNELS.PTY_LIST) as Promise<{ sessionId: string; pid: number }[]>
      ]);

      const activePtyMap = new Map(activePtys.map((p: { sessionId: string; pid: number }) => [p.sessionId, p.pid]));
      let added = 0;

      for (const metadata of savedSessions) {
        const pid = activePtyMap.get(metadata.sessionId);
        if (pid !== undefined && !this.sessionStateService.hasSession(metadata.sessionId)) {
          this.sessionStateService.addSession(metadata, pid);
          added++;
        }
      }

      if (added > 0) {
        console.log(`[App] Restored ${added} session(s)`);
      }
      return added;
    } catch (error) {
      console.error('[App] Failed to load restored sessions:', error);
      return 0;
    }
  }

  private async loadRemoteSessions(): Promise<number> {
    try {
      const resp = await fetch(`http://${window.location.hostname}:9801/api/sessions`);
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
