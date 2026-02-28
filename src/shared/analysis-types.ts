/**
 * Shared types for Claude CLI session log analysis.
 *
 * Used by both the Electron main process (log analyzer engine)
 * and Angular renderer (analysis dashboard components).
 */

/** Overview statistics aggregated across all sessions. */
export interface AnalysisOverview {
  readonly totalSessions: number;
  readonly totalMessages: number;
  readonly totalToolCalls: number;
  readonly dateRange: { from: string; to: string };
}

/** Per-tool usage statistics. */
export interface ToolUsageStat {
  readonly name: string;
  readonly count: number;
  readonly percentage: number;
}

/** Per-skill/command usage (slash commands). */
export interface SkillUsageStat {
  readonly command: string;
  readonly count: number;
}

/** Token usage aggregates with cache efficiency. */
export interface TokenUsage {
  readonly totalInput: number;
  readonly totalOutput: number;
  readonly totalCacheRead: number;
  readonly totalCacheCreation: number;
  readonly cacheHitRatio: number;
}

/** Detected problem or error pattern. */
export interface Problem {
  readonly type: string;
  readonly message: string;
  readonly count: number;
}

/** Recommendation with severity level. */
export interface Recommendation {
  readonly severity: 'praise' | 'tip' | 'warning' | 'anti-pattern' | 'achievement';
  readonly title: string;
  readonly description: string;
  readonly metric?: string;
}

/** Anti-pattern occurrence with concrete turn reference. */
export interface AntiPatternOccurrence {
  readonly pattern: 'bash-for-file-ops' | 'correction-loop' | 'kitchen-sink' | 'infinite-exploration';
  readonly turn: number;
  readonly detail: string;
}

/** Main analysis result aggregated across all sessions. */
export interface SessionAnalysis {
  readonly overview: AnalysisOverview;
  readonly toolUsage: ToolUsageStat[];
  readonly skillUsage: SkillUsageStat[];
  readonly tokenUsage: TokenUsage;
  readonly problems: Problem[];
  readonly recommendations: Recommendation[];
  readonly practiceScore: number;
}

/** Per-session practice score for tile headers. */
export interface SessionPracticeScore {
  readonly sessionId: string;
  readonly score: number;
  readonly badges: string[];
  readonly highlights: string[];
}

/** Score breakdown for per-session detail view. */
export interface SessionScoreDetail extends SessionPracticeScore {
  readonly toolNativenessScore: number;
  readonly subagentScore: number;
  readonly readBeforeWriteScore: number;
  readonly contextEfficiencyScore: number;
  readonly errorScore: number;
  readonly antiPatterns: AntiPatternOccurrence[];
  readonly recommendations: Recommendation[];
  readonly avgTurnDurationMs: number;
  readonly compactBoundaryCount: number;
  readonly modelUsed: string | null;
  readonly apiErrorCount: number;
  readonly serverToolUseCount: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
}

/** Single entry in the score history for trend tracking. */
export interface ScoreHistoryEntry {
  readonly sessionId: string;
  readonly timestamp: string;
  readonly score: number;
  readonly toolNativenessScore: number;
  readonly subagentScore: number;
  readonly readBeforeWriteScore: number;
  readonly contextEfficiencyScore: number;
  readonly errorScore: number;
  readonly antiPatternCount: number;
}

/** Trend data for the sparkline section. */
export interface ScoreTrends {
  readonly entries: ScoreHistoryEntry[];
  readonly totalScore: number[];
  readonly toolNativeness: number[];
  readonly subagent: number[];
  readonly readBeforeWrite: number[];
  readonly contextEfficiency: number[];
  readonly errorScore: number[];
  readonly antiPatternCount: number[];
}
