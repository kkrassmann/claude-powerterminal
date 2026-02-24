import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { SessionMetadata } from '../models/session.model';
import { ScrollbackBuffer } from './scrollback-buffer.service';

/**
 * Represents an active terminal session with runtime state.
 *
 * Combines session metadata (persisted to disk) with runtime state
 * (PTY process, scrollback buffer) that only exists while session is active.
 */
export interface ActiveSession {
  /**
   * Session metadata (ID, working directory, flags, creation time).
   */
  metadata: SessionMetadata;

  /**
   * Process ID of the underlying PTY process.
   */
  pid: number;

  /**
   * Circular buffer for terminal output scrollback.
   */
  scrollbackBuffer: ScrollbackBuffer;
}

/**
 * Service for managing in-memory active session state.
 *
 * Maintains a reactive map of currently running sessions with their
 * associated PTY processes and scrollback buffers. Uses RxJS BehaviorSubject
 * for reactive state updates that components can subscribe to.
 *
 * Architecture:
 * - SessionManagerService handles persistence (disk storage)
 * - SessionStateService handles runtime state (in-memory only)
 * - PtyManagerService handles PTY lifecycle (spawn/kill/write)
 *
 * This service bridges the gap between persistence and runtime, tracking
 * which sessions are currently active and their live output buffers.
 */
@Injectable({
  providedIn: 'root'
})
export class SessionStateService {
  /**
   * Internal subject holding the map of active sessions.
   * Map key is sessionId, value is ActiveSession with metadata, pid, and buffer.
   */
  private sessionsSubject = new BehaviorSubject<Map<string, ActiveSession>>(new Map());

  /**
   * Observable stream of active sessions map.
   * Components can subscribe to this to react to session state changes.
   *
   * @example
   * sessionState.sessions$.subscribe(sessions => {
   *   console.log(`Active sessions: ${sessions.size}`);
   *   sessions.forEach(session => {
   *     console.log(`Session ${session.metadata.sessionId} at ${session.metadata.workingDirectory}`);
   *   });
   * });
   */
  public sessions$: Observable<Map<string, ActiveSession>> = this.sessionsSubject.asObservable();

  constructor() {}

  /**
   * Add a new active session to the state.
   *
   * Creates a new ActiveSession with fresh ScrollbackBuffer and adds it to
   * the internal map. Emits the updated map to all subscribers.
   *
   * @param metadata - Session metadata (ID, working directory, flags, timestamp)
   * @param pid - Process ID of the spawned PTY process
   *
   * @example
   * sessionState.addSession(
   *   {
   *     sessionId: '123e4567-e89b-12d3-a456-426614174000',
   *     workingDirectory: 'C:\\projects\\my-app',
   *     cliFlags: ['--verbose'],
   *     createdAt: '2024-02-24T08:00:00.000Z'
   *   },
   *   12345
   * );
   */
  addSession(metadata: SessionMetadata, pid: number): void {
    const currentSessions = this.sessionsSubject.value;

    const activeSession: ActiveSession = {
      metadata,
      pid,
      scrollbackBuffer: new ScrollbackBuffer(10000) // 10k line limit per plan
    };

    currentSessions.set(metadata.sessionId, activeSession);

    // Emit updated map (triggers subscribers)
    this.sessionsSubject.next(currentSessions);
  }

  /**
   * Remove a session from active state.
   *
   * Deletes the session from the internal map and emits the updated map.
   * Scrollback buffer is automatically garbage collected.
   *
   * Note: This only removes from in-memory state. To delete persisted
   * session data, use SessionManagerService.deleteSession().
   *
   * @param sessionId - Unique identifier of the session to remove
   *
   * @example
   * sessionState.removeSession('123e4567-e89b-12d3-a456-426614174000');
   */
  removeSession(sessionId: string): void {
    const currentSessions = this.sessionsSubject.value;

    currentSessions.delete(sessionId);

    // Emit updated map (triggers subscribers)
    this.sessionsSubject.next(currentSessions);
  }

  /**
   * Get a specific active session by ID.
   *
   * @param sessionId - Unique identifier of the session to retrieve
   * @returns ActiveSession if found, undefined otherwise
   *
   * @example
   * const session = sessionState.getSession('123e4567-e89b-12d3-a456-426614174000');
   * if (session) {
   *   console.log(`Session PID: ${session.pid}`);
   *   console.log(`Buffered lines: ${session.scrollbackBuffer.getLineCount()}`);
   * }
   */
  getSession(sessionId: string): ActiveSession | undefined {
    return this.sessionsSubject.value.get(sessionId);
  }

  /**
   * Append output data to a session's scrollback buffer.
   *
   * Retrieves the session from the map, appends data to its scrollback buffer,
   * and emits the updated map to trigger reactive updates.
   *
   * Note: The map itself doesn't change (same references), but emitting it
   * notifies subscribers that session state has been modified. If fine-grained
   * reactivity is needed, consider a separate subject for output updates.
   *
   * @param sessionId - Target session ID
   * @param data - Terminal output data to append
   *
   * @example
   * // Called when PTY_DATA event received
   * ptyManager.listenForOutput((event) => {
   *   sessionState.appendOutput(event.sessionId, event.data);
   * });
   */
  appendOutput(sessionId: string, data: string): void {
    const session = this.getSession(sessionId);

    if (session) {
      session.scrollbackBuffer.append(data);

      // Emit updated map to notify subscribers
      // (Map reference stays the same, but content changed)
      this.sessionsSubject.next(this.sessionsSubject.value);
    } else {
      console.warn(`Attempted to append output to unknown session: ${sessionId}`);
    }
  }

  /**
   * Get all active sessions as an array.
   *
   * @returns Array of all active sessions
   *
   * @example
   * const sessions = sessionState.getAllSessions();
   * console.log(`Total active sessions: ${sessions.length}`);
   */
  getAllSessions(): ActiveSession[] {
    return Array.from(this.sessionsSubject.value.values());
  }

  /**
   * Check if a session is currently active.
   *
   * @param sessionId - Session ID to check
   * @returns True if session exists in active state
   *
   * @example
   * if (sessionState.hasSession('123e4567-e89b-12d3-a456-426614174000')) {
   *   console.log('Session is active');
   * }
   */
  hasSession(sessionId: string): boolean {
    return this.sessionsSubject.value.has(sessionId);
  }

  /**
   * Clear all active sessions.
   *
   * Removes all sessions from state. Used for cleanup on app shutdown
   * or when testing.
   *
   * @example
   * sessionState.clearAll();
   */
  clearAll(): void {
    this.sessionsSubject.next(new Map());
  }
}
