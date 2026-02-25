import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, ViewChild, ElementRef, NgZone, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ServerMessage, ClientMessage, WS_PORT, TerminalStatus } from '../../../../shared/ws-protocol';
import { IPC_CHANNELS } from '../../../../shared/ipc-channels';

/**
 * xterm.js terminal component with WebSocket bridge to PTY process.
 *
 * Features:
 * - WebGL renderer with DOM fallback
 * - Catppuccin Mocha dark theme with Cascadia Code font
 * - Block blinking cursor, 10k scrollback
 * - Clipboard handling: Ctrl+C copies when selected, sends SIGINT otherwise
 * - Ctrl+V handled by browser (paste)
 * - Auto-reconnect with exponential backoff
 * - Buffer replay with terminal reset on reconnect
 * - Debounced resize (200ms) with PTY notification
 * - All operations run outside Angular zone to avoid change detection storms
 */
@Component({
  selector: 'app-terminal',
  standalone: true,
  template: `
    <div class="restart-overlay" *ngIf="isRestarting">
      <div class="restart-indicator">
        <div class="spinner"></div>
        <span>Session wird neu gestartet...</span>
      </div>
    </div>
    <div #terminalContainer class="terminal-container" [class.hidden]="isRestarting" (contextmenu)="onContextMenu($event)"></div>
    <div *ngIf="contextMenuVisible" class="context-menu" [style.left.px]="contextMenuX" [style.top.px]="contextMenuY" (mousedown)="$event.stopPropagation()">
      <button class="context-menu-item" (click)="restartSession()">Neu starten</button>
      <button class="context-menu-item danger" (click)="killSession()">Session beenden</button>
    </div>
  `,
  imports: [CommonModule],
  styleUrls: ['./terminal.component.css']
})
export class TerminalComponent implements OnInit, OnDestroy {
  @Input() sessionId!: string;
  @Output() sessionExited = new EventEmitter<string>();
  @Output() statusChanged = new EventEmitter<{ sessionId: string; status: TerminalStatus }>();
  @ViewChild('terminalContainer', { static: true }) terminalContainer!: ElementRef<HTMLDivElement>;

  private term!: Terminal;
  private fitAddon!: FitAddon;
  private socket!: WebSocket;
  private resizeObserver!: ResizeObserver;
  private resizeTimeout: any = null;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30000;
  private destroyed = false;
  private isBuffering = false;
  private inputDisposable: any = null; // Tracks term.onData listener to prevent leaks
  private resyncInterval?: any; // Periodic buffer resync for remote browsers

  contextMenuVisible = false;
  contextMenuX = 0;
  contextMenuY = 0;
  isRestarting = false;

  constructor(private ngZone: NgZone) {}

  @HostListener('document:mousedown')
  onDocumentMouseDown(): void {
    this.contextMenuVisible = false;
  }

  onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    this.contextMenuX = event.clientX;
    this.contextMenuY = event.clientY;
    this.contextMenuVisible = true;
  }

  async restartSession(): Promise<void> {
    this.contextMenuVisible = false;
    this.isRestarting = true;

    // Close current WebSocket — the old PTY will be killed server-side
    this.socket?.close();

    if (!window.electronAPI) {
      this.isRestarting = false;
      this.term.write('\r\n[Restart not available in remote browser]\r\n');
      return;
    }

    const result = await window.electronAPI.invoke(IPC_CHANNELS.PTY_RESTART, this.sessionId, this.term.cols, this.term.rows);
    if (result?.success) {
      // Reset terminal before reconnecting so old content is gone
      this.term.reset();
      this.ngZone.runOutsideAngular(() => this.connectWebSocket());
    } else {
      this.isRestarting = false;
      this.term.write(`\r\n[Restart failed: ${result?.error}]\r\n`);
    }
  }

  killSession(): void {
    this.contextMenuVisible = false;
    if (!window.electronAPI) return;
    window.electronAPI.invoke(IPC_CHANNELS.PTY_KILL, this.sessionId);
  }

  ngOnInit(): void {
    // Run everything outside Angular zone to avoid change detection storms
    this.ngZone.runOutsideAngular(() => {
      this.initTerminal();
      this.connectWebSocket();
      this.setupResizeHandler();
    });
  }

  /**
   * Initialize xterm.js terminal with Catppuccin Mocha theme.
   */
  private initTerminal(): void {
    this.term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, monospace',
      scrollback: 10000,
      scrollOnUserInput: true,
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        cursorAccent: '#1e1e2e',
        selectionBackground: '#585b70',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#f5c2e7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#f5c2e7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8'
      }
    });

    // Load FitAddon for automatic terminal sizing
    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);

    // Load WebLinksAddon for clickable URLs
    this.term.loadAddon(new WebLinksAddon());

    // Open terminal in container
    this.term.open(this.terminalContainer.nativeElement);

    // Load WebGL addon with DOM fallback (MUST be after open())
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
        // DOM renderer activates automatically as fallback
        console.warn('[Terminal] WebGL context lost, falling back to DOM renderer');
      });
      this.term.loadAddon(webglAddon);
    } catch (e) {
      console.warn('[Terminal] WebGL unavailable, using DOM renderer', e);
    }

    // Fit terminal to container
    this.fitAddon.fit();

    // Setup clipboard handling
    this.setupClipboard();
  }

  /**
   * Setup clipboard handling:
   * - Ctrl+C: Copy when text is selected, send SIGINT otherwise
   * - Ctrl+V: Let browser handle paste
   * - All other keys: Pass through to PTY
   */
  private setupClipboard(): void {
    this.term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type !== 'keydown') return true;

      if (event.ctrlKey && event.code === 'KeyC') {
        if (this.term.hasSelection()) {
          navigator.clipboard.writeText(this.term.getSelection());
          this.term.clearSelection();
          return false; // Prevent xterm from sending \x03
        }
        return true; // No selection: send SIGINT
      }

      if (event.ctrlKey && event.code === 'KeyV') {
        return false; // Let browser handle paste
      }

      return true; // All other keys pass through to PTY
    });
  }

  /**
   * Connect to WebSocket server and setup message handlers.
   */
  private connectWebSocket(): void {
    const wsHost = window.location.hostname || 'localhost';
    this.socket = new WebSocket(`ws://${wsHost}:${WS_PORT}/terminal/${this.sessionId}`);

    this.socket.onopen = () => {
      this.reconnectAttempts = 0;
      console.log(`[Terminal] WebSocket connected for session ${this.sessionId}`);

      // Send actual terminal dimensions so PTY matches our display
      const msg: ClientMessage = { type: 'resize', cols: this.term.cols, rows: this.term.rows };
      this.socket.send(JSON.stringify(msg));

      // Periodic buffer resync for remote browsers (prevents xterm.js desync)
      // Only run for remote browsers — Electron has lower latency and no network issues
      if (!window.electronAPI && this.socket.readyState === WebSocket.OPEN) {
        // Clear any existing interval (in case of reconnect)
        if (this.resyncInterval) {
          clearInterval(this.resyncInterval);
        }

        this.resyncInterval = setInterval(() => {
          if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            console.log('[Terminal] Requesting buffer resync');
            this.socket.send(JSON.stringify({ type: 'buffer-replay' }));
          }
        }, 30000); // 30-second interval
      }
    };

    this.socket.onmessage = (event: MessageEvent) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);

        switch (msg.type) {
          case 'buffering':
            // Buffer replay starting - reset terminal to prevent duplicate content
            this.isBuffering = true;
            this.term.reset();
            console.log(`[Terminal] Buffer replay starting: ${msg.total} lines`);
            break;

          case 'buffered':
            // Buffer replay complete
            this.isBuffering = false;
            if (this.isRestarting) {
              this.isRestarting = false;
              this.fitAddon.fit();
            }
            console.log('[Terminal] Buffer replay complete');
            break;

          case 'buffer-clear':
            // Server requested terminal clear (before buffer replay)
            this.term.clear();
            console.log('[Terminal] Cleared terminal for buffer replay');
            break;

          case 'buffer-replay':
            // Server sent full buffer replay
            this.term.clear();
            this.term.write(msg.data);
            console.log('[Terminal] Buffer replay received');
            break;

          case 'output':
            // PTY output data
            this.term.write(msg.data);
            // Show terminal on first output after restart (if no buffer replay)
            if (this.isRestarting && !this.isBuffering) {
              this.isRestarting = false;
              this.fitAddon.fit();
            }
            break;

          case 'exit':
            if (this.isRestarting) break; // Ignore exit during restart
            this.term.write(`\r\n[Process exited with code ${msg.exitCode}]\r\n`);
            this.ngZone.run(() => this.sessionExited.emit(this.sessionId));
            break;

          case 'status':
            // Forward status changes to parent component
            this.ngZone.run(() => this.statusChanged.emit({ sessionId: this.sessionId, status: msg.status }));
            break;
        }
      } catch (error) {
        console.error('[Terminal] Failed to parse WebSocket message:', error);
      }
    };

    this.socket.onclose = (event: CloseEvent) => {
      console.log(`[Terminal] WebSocket closed for session ${this.sessionId}`, event.code);

      // Only reconnect if not destroyed and not after an exit message
      if (!this.destroyed && event.code !== 1000) {
        this.scheduleReconnect();
      }
    };

    this.socket.onerror = (error: Event) => {
      console.error('[Terminal] WebSocket error:', error);
      // onclose fires after onerror
    };

    // Forward user input to WebSocket (dispose previous listener to prevent leaks)
    this.inputDisposable?.dispose();
    this.inputDisposable = this.term.onData((data: string) => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        const msg: ClientMessage = { type: 'input', data };
        this.socket.send(JSON.stringify(msg));
      }
    });
  }

  /**
   * Schedule WebSocket reconnect with exponential backoff and jitter.
   */
  private scheduleReconnect(): void {
    const baseDelay = 1000;
    const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
    const jitter = delay * 0.1 * (Math.random() - 0.5);
    const totalDelay = delay + jitter;

    console.log(`[Terminal] Reconnecting in ${Math.round(totalDelay)}ms (attempt ${this.reconnectAttempts + 1})`);

    setTimeout(() => {
      this.reconnectAttempts++;
      this.connectWebSocket();
    }, totalDelay);
  }

  /**
   * Setup ResizeObserver with 200ms debounce to handle container resizing.
   */
  private setupResizeHandler(): void {
    this.resizeObserver = new ResizeObserver(() => {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = setTimeout(() => {
        this.fitAddon.fit();

        // Notify PTY of new terminal size
        if (this.socket?.readyState === WebSocket.OPEN) {
          const msg: ClientMessage = {
            type: 'resize',
            cols: this.term.cols,
            rows: this.term.rows
          };
          this.socket.send(JSON.stringify(msg));
        }
      }, 200);
    });

    this.resizeObserver.observe(this.terminalContainer.nativeElement);
  }

  ngOnDestroy(): void {
    this.destroyed = true;

    // Clean up everything to prevent memory leaks
    clearTimeout(this.resizeTimeout);
    if (this.resyncInterval) {
      clearInterval(this.resyncInterval);
    }
    this.resizeObserver?.disconnect();
    this.socket?.close();
    this.term?.dispose();
  }
}
