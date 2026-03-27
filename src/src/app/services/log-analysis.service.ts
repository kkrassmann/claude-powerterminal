import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { getHttpBaseUrl } from '../../../shared/ws-protocol';
import type { SessionAnalysis, SessionPracticeScore, SessionScoreDetail, ScoreTrends } from '../../../shared/analysis-types';

/**
 * Service for fetching Claude CLI session log analysis data via HTTP API.
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
      const resp = await fetch(`${getHttpBaseUrl()}/api/analysis`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const analysis: SessionAnalysis = await resp.json();
      this.analysisSubject.next(analysis);
    } catch (error: any) {
      console.warn('[LogAnalysisService] Failed to load analysis:', error.message);
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

      const resp = await fetch(
        `${getHttpBaseUrl()}/api/analysis/session?id=${encodeURIComponent(sessionId)}`
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
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
      const res = await fetch(
        `${getHttpBaseUrl()}/api/analysis/session-detail?sessionId=${encodeURIComponent(sessionId)}`
      );
      return await res.json();
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
      const res = await fetch(`${getHttpBaseUrl()}/api/analysis/trends`);
      return await res.json();
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
