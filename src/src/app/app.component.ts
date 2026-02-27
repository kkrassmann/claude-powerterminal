import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { SessionCreateComponent } from './components/session-create/session-create.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { SessionStateService } from './services/session-state.service';
import { SessionManagerService } from './services/session-manager.service';
import { SessionMetadata } from './models/session.model';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { AudioAlertService } from './services/audio-alert.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SessionCreateComponent, DashboardComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  title = 'Claude PowerTerminal';
  pendingSessions: SessionMetadata[] = [];
  lanUrl: string | null = null;

  constructor(
    private sessionStateService: SessionStateService,
    private sessionManager: SessionManagerService,
    public audioAlertService: AudioAlertService
  ) {}

  ngOnInit(): void {
    // Fetch LAN URL if running in Electron
    if (window.electronAPI) {
      window.electronAPI.invoke('app:lan-url').then((url: string | null) => {
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
