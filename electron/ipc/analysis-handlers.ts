/**
 * Analysis IPC handlers for retrieving session log analysis data.
 *
 * Provides analysis overview (tool usage, recommendations, scores)
 * and per-session practice scores for tile headers.
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { analyzeAllSessions, computeSessionScore } from '../analysis/log-analyzer';
import type { SessionAnalysis, SessionPracticeScore } from '../../src/shared/analysis-types';

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
  ipcMain.handle(IPC_CHANNELS.LOG_SESSION_SCORE, async (_event, sessionId: string): Promise<SessionPracticeScore> => {
    try {
      if (!sessionId) {
        return { sessionId: '', score: 0, badges: [], highlights: ['Missing session ID'] };
      }
      return await computeSessionScore(sessionId);
    } catch (error: any) {
      console.error(`[Analysis Handlers] computeSessionScore failed for ${sessionId}:`, error.message);
      return { sessionId: sessionId || '', score: 0, badges: [], highlights: ['Error computing score'] };
    }
  });

  console.log('[Analysis Handlers] All analysis IPC handlers registered successfully');
}
