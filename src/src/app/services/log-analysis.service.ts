import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { IPC_CHANNELS } from '../../../shared/ipc-channels';
import type { SessionAnalysis, SessionPracticeScore, SessionScoreDetail, ScoreTrends } from '../../../shared/analysis-types';

/**
 * Service for fetching Claude CLI session log analysis data.
 *
 * Dual-mode operation:
 * - Electron (IPC): Uses window.electronAPI.invoke for local analysis
 * - Remote browser (HTTP): Falls back to HTTP API endpoints on the static server
 *
 * Provides:
 * - Full session analysis (tool usage, token stats, recommendations, practice score)
 * - Per-session practice scores for tile header badges
 * - Loading state tracking for UI spinners
 * - Silent failure with console.warn (like GitContextService)
 */
@Injectable({
  providedIn: 'root'
})
export class LogAnalysisService implements OnDestroy {
  /**
   * Latest full session analysis result.
   * Null until first successful load.
   */
  private analysisSubject = new BehaviorSubject<SessionAnalysis | null>(null);

  /**
   * Observable for components to subscribe to analysis data.
   */
  public analysis$: Observable<SessionAnalysis | null> = this.analysisSubject.asObservable();

  /**
   * Whether a full analysis load is in progress.
   */
  public loading = false;

  /**
   * Load full session analysis from backend.
   * Updates analysis$ observable on success.
   * Silent failure on errors (logs warning, keeps previous value).
   */
  async loadAnalysis(): Promise<void> {
    if (this.loading) return;
    this.loading = true;

    try {
      let analysis: SessionAnalysis;

      if (window.electronAPI) {
        analysis = await window.electronAPI.invoke(IPC_CHANNELS.LOG_ANALYSIS);
      } else {
        const resp = await fetch(`http://${window.location.hostname}:9801/api/analysis`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        analysis = await resp.json();
      }

      this.analysisSubject.next(analysis);
    } catch (error: any) {
      console.warn('[LogAnalysisService] Failed to load analysis:', error.message);
      // Keep previous value (silent failure)
    } finally {
      this.loading = false;
    }
  }

  /**
   * Load practice score for a single session.
   * Returns the score data or a fallback on error.
   *
   * @param sessionId - Unique session identifier
   * @returns SessionPracticeScore for the given session
   */
  async loadSessionScore(sessionId: string): Promise<SessionPracticeScore> {
    try {
      if (!sessionId) {
        return { sessionId: '', score: 0, badges: [], highlights: [] };
      }

      let score: SessionPracticeScore;

      if (window.electronAPI) {
        score = await window.electronAPI.invoke(IPC_CHANNELS.LOG_SESSION_SCORE, sessionId);
      } else {
        const resp = await fetch(
          `http://${window.location.hostname}:9801/api/analysis/session?id=${encodeURIComponent(sessionId)}`
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        score = await resp.json();
      }

      return score;
    } catch (error: any) {
      console.warn(`[LogAnalysisService] Failed to load score for ${sessionId}:`, error.message);
      return { sessionId, score: 0, badges: [], highlights: [] };
    }
  }

  /**
   * Load detailed score breakdown for a single session.
   * Returns null on error.
   *
   * @param sessionId - Unique session identifier
   * @returns SessionScoreDetail or null on error
   */
  async loadSessionDetail(sessionId: string): Promise<SessionScoreDetail | null> {
    try {
      if (window.electronAPI) {
        return await window.electronAPI.invoke(IPC_CHANNELS.LOG_SESSION_DETAIL, sessionId);
      } else {
        const res = await fetch(
          `http://${window.location.hostname}:9801/api/analysis/session-detail?sessionId=${encodeURIComponent(sessionId)}`
        );
        return await res.json();
      }
    } catch {
      return null;
    }
  }

  /**
   * Load score trend data for sparkline visualizations.
   * Returns null on error.
   *
   * @returns ScoreTrends or null on error
   */
  async loadTrends(): Promise<ScoreTrends | null> {
    try {
      if (window.electronAPI) {
        return await window.electronAPI.invoke(IPC_CHANNELS.LOG_SCORE_TRENDS);
      } else {
        const res = await fetch(`http://${window.location.hostname}:9801/api/analysis/trends`);
        return await res.json();
      }
    } catch {
      return null;
    }
  }

  /**
   * Get current analysis value synchronously (snapshot).
   */
  getAnalysis(): SessionAnalysis | null {
    return this.analysisSubject.value;
  }

  ngOnDestroy(): void {
    // No polling to stop — analysis is on-demand
  }
}
