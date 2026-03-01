/**
 * Analysis IPC handlers for retrieving session log analysis data.
 *
 * Provides analysis overview (tool usage, recommendations, scores),
 * per-session practice scores for tile headers, per-session detail views,
 * and score trend tracking across sessions.
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { analyzeAllSessions, computeSessionScore } from '../analysis/log-analyzer';
import { appendScoreHistory, getTrends } from '../analysis/score-history';
import { discoverClaudeProjects, runProjectAudit } from '../analysis/audit-engine';
import type { SessionAnalysis, SessionScoreDetail } from '../../src/shared/analysis-types';

// Per-session detail cache with 5-minute TTL
// Avoids re-parsing when user opens multiple session details in sequence
const sessionDetailCache = new Map<string, { result: SessionScoreDetail; cachedAt: number }>();
const DETAIL_CACHE_TTL = 5 * 60 * 1000;

/**
 * Register all analysis-related IPC handlers.
 * Call this once during app initialization in main.ts.
 */
export function registerAnalysisHandlers(): void {
  console.log('[Analysis Handlers] Registering analysis IPC handlers');

  // Handler 1: analysis:logs - Get full session analysis
  ipcMain.handle(IPC_CHANNELS.LOG_ANALYSIS, async (): Promise<SessionAnalysis> => {
    try {
      return await analyzeAllSessions();
    } catch (error: any) {
      console.error('[Analysis Handlers] analyzeAllSessions failed:', error.message);
      // Return safe empty result
      return {
        overview: { totalSessions: 0, totalMessages: 0, totalToolCalls: 0, dateRange: { from: 'N/A', to: 'N/A' } },
        toolUsage: [],
        skillUsage: [],
        tokenUsage: { totalInput: 0, totalOutput: 0, totalCacheRead: 0, totalCacheCreation: 0, cacheHitRatio: 0 },
        problems: [],
        recommendations: [],
        practiceScore: 0,
      };
    }
  });

  // Handler 2: analysis:session-score - Get practice score for a single session
  // Also persists result to score history for trend tracking
  ipcMain.handle(IPC_CHANNELS.LOG_SESSION_SCORE, async (_event, sessionId: string): Promise<SessionScoreDetail | { sessionId: string; score: number; badges: string[]; highlights: string[] }> => {
    try {
      if (!sessionId) {
        return { sessionId: '', score: 0, badges: [], highlights: ['Missing session ID'] };
      }
      const result = await computeSessionScore(sessionId);
      if (result) {
        appendScoreHistory({
          sessionId: result.sessionId,
          timestamp: new Date().toISOString(),
          score: result.score,
          toolNativenessScore: result.toolNativenessScore,
          subagentScore: result.subagentScore,
          readBeforeWriteScore: result.readBeforeWriteScore,
          contextEfficiencyScore: result.contextEfficiencyScore,
          errorScore: result.errorScore,
          antiPatternCount: result.antiPatterns?.length ?? 0,
        });
      }
      return result;
    } catch (error: any) {
      console.error(`[Analysis Handlers] computeSessionScore failed for ${sessionId}:`, error.message);
      return { sessionId: sessionId || '', score: 0, badges: [], highlights: ['Error computing score'] };
    }
  });

  // Handler 3: analysis:session-detail - Get full session score detail (with cache)
  ipcMain.handle(IPC_CHANNELS.LOG_SESSION_DETAIL, async (_event, sessionId: string) => {
    const now = Date.now();
    const cached = sessionDetailCache.get(sessionId);
    if (cached && now - cached.cachedAt < DETAIL_CACHE_TTL) {
      return cached.result;
    }
    const result = await computeSessionScore(sessionId);
    if (result) {
      sessionDetailCache.set(sessionId, { result, cachedAt: now });
    }
    return result ?? null;
  });

  // Handler 4: analysis:score-trends - Get trend data for last 10 sessions
  ipcMain.handle(IPC_CHANNELS.LOG_SCORE_TRENDS, async () => {
    const entries = getTrends(10);
    return {
      entries,
      totalScore: entries.map(e => e.score),
      toolNativeness: entries.map(e => e.toolNativenessScore),
      subagent: entries.map(e => e.subagentScore),
      readBeforeWrite: entries.map(e => e.readBeforeWriteScore),
      contextEfficiency: entries.map(e => e.contextEfficiencyScore),
      errorScore: entries.map(e => e.errorScore),
      antiPatternCount: entries.map(e => e.antiPatternCount),
    };
  });

  // Handler 5: audit:projects - Discover Claude project paths from ~/.claude/projects/
  ipcMain.handle(IPC_CHANNELS.AUDIT_PROJECTS, async () => {
    return discoverClaudeProjects();
  });

  // Handler 6: audit:run - Run heuristic audit for a given project path
  ipcMain.handle(IPC_CHANNELS.AUDIT_RUN, async (_event, projectPath: string) => {
    return runProjectAudit(projectPath);
  });

  console.log('[Analysis Handlers] All analysis IPC handlers registered successfully');
}
