/**
 * Claude CLI session log analyzer engine.
 *
 * Parses JSONL session logs, stats-cache.json, and history.jsonl
 * to produce actionable insights: tool usage, token efficiency,
 * workflow recommendations (praise + improvement), and practice scores.
 *
 * Key design: streams JSONL line-by-line via readline — never loads entire file into RAM.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as os from 'os';
import {
  SessionAnalysis,
  SessionPracticeScore,
  SessionScoreDetail,
  AntiPatternOccurrence,
  AnalysisOverview,
  ToolUsageStat,
  SkillUsageStat,
  TokenUsage,
  Problem,
  Recommendation,
} from '../../src/shared/analysis-types';

// ── Limits ──────────────────────────────────────────────────────────────
const MAX_JSONL_FILES = 50;
const MAX_LINES_PER_FILE = 20_000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_TOOL_CALL_SEQUENCE = 2000;

// ── Cache ───────────────────────────────────────────────────────────────
let cachedResult: SessionAnalysis | null = null;
let cachedAt = 0;

// ── Internal types ───────────────────────────────────────────────────────

/** Internal representation of a single tool call in sequence order. */
interface ToolCallEvent {
  turnIndex: number;
  toolName: string;
  targetFile?: string;
  bashCommand?: string;
  isError: boolean;
}

// ── Internal accumulator ────────────────────────────────────────────────
interface ParsedStats {
  totalMessages: number;
  totalToolCalls: number;
  toolCounts: Map<string, number>;
  skillCounts: Map<string, number>;
  tokenInput: number;
  tokenOutput: number;
  tokenCacheRead: number;
  tokenCacheCreation: number;
  errorCount: number;
  sessionCount: number;
  earliestDate: string;
  latestDate: string;
  maxMessagesInSession: number;
  // Phase 7: new fields
  turnDurations: number[];
  compactBoundaryCount: number;
  modelUsed: string | null;
  sidechainMessages: number;
  toolCallSequence: ToolCallEvent[];
  apiErrorCount: number;
  serverToolUseCount: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

function emptyStats(): ParsedStats {
  return {
    totalMessages: 0,
    totalToolCalls: 0,
    toolCounts: new Map(),
    skillCounts: new Map(),
    tokenInput: 0,
    tokenOutput: 0,
    tokenCacheRead: 0,
    tokenCacheCreation: 0,
    errorCount: 0,
    sessionCount: 0,
    earliestDate: '',
    latestDate: '',
    maxMessagesInSession: 0,
    // Phase 7 fields
    turnDurations: [],
    compactBoundaryCount: 0,
    modelUsed: null,
    sidechainMessages: 0,
    toolCallSequence: [],
    apiErrorCount: 0,
    serverToolUseCount: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };
}

// ── JSONL file discovery ────────────────────────────────────────────────

/**
 * Get the Claude home directory.
 */
export function getClaudeHome(): string {
  return path.join(os.homedir(), '.claude');
}

/**
 * Discover JSONL session files under ~/.claude/projects/.
 * Returns up to MAX_JSONL_FILES paths, sorted by mtime descending (newest first).
 */
export function discoverSessionFiles(claudeHome?: string): string[] {
  const home = claudeHome ?? getClaudeHome();
  const projectsDir = path.join(home, 'projects');
  const files: { path: string; mtime: number }[] = [];

  if (!fs.existsSync(projectsDir)) return [];

  try {
    const projectDirs = fs.readdirSync(projectsDir);
    for (const dir of projectDirs) {
      const projectPath = path.join(projectsDir, dir);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(projectPath);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      try {
        const entries = fs.readdirSync(projectPath);
        for (const entry of entries) {
          if (!entry.endsWith('.jsonl')) continue;
          const fullPath = path.join(projectPath, entry);
          try {
            const fstat = fs.statSync(fullPath);
            files.push({ path: fullPath, mtime: fstat.mtimeMs });
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }
  } catch {
    return [];
  }

  // Sort newest first, limit to MAX
  files.sort((a, b) => b.mtime - a.mtime);
  return files.slice(0, MAX_JSONL_FILES).map(f => f.path);
}

// ── Streaming JSONL parser ──────────────────────────────────────────────

/**
 * Parse a single JSONL file line-by-line.
 * Extracts tool_use blocks, token usage, skill detection, error detection,
 * and Phase 7 fields: turn_duration, compact_boundary, model, isSidechain,
 * api_error, server_tool_use, cache tiers, tool call sequence.
 */
export async function parseJsonlFile(filePath: string, stats: ParsedStats): Promise<number> {
  return new Promise((resolve, reject) => {
    let lineCount = 0;
    let messageCount = 0;

    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      lineCount++;
      if (lineCount > MAX_LINES_PER_FILE) {
        rl.close();
        stream.destroy();
        return;
      }

      const trimmed = line.trim();
      if (!trimmed) return;

      let parsed: any;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return; // Skip corrupt lines
      }

      messageCount++;

      // Extract file timestamp for date range
      if (parsed.timestamp) {
        const ts = String(parsed.timestamp);
        if (!stats.earliestDate || ts < stats.earliestDate) stats.earliestDate = ts;
        if (!stats.latestDate || ts > stats.latestDate) stats.latestDate = ts;
      }

      // Phase 7: system record extraction (turn_duration, compact_boundary)
      if (parsed.type === 'system') {
        if (parsed.subtype === 'turn_duration' && typeof parsed.durationMs === 'number') {
          stats.turnDurations.push(parsed.durationMs);
        }
        if (parsed.subtype === 'compact_boundary') {
          stats.compactBoundaryCount++;
        }
      }

      // Phase 7: api_error detection
      if (parsed.type === 'api_error' || (parsed.type === 'assistant' && parsed.error)) {
        stats.apiErrorCount++;
      }

      // Phase 7: model tracking (last seen model)
      if (parsed.type === 'assistant' && parsed.message?.model) {
        stats.modelUsed = parsed.message.model;
      }

      // Phase 7: cache token tiers from assistant messages
      if (parsed.type === 'assistant' && parsed.message?.usage) {
        stats.cacheCreationTokens += parsed.message.usage.cache_creation_input_tokens ?? 0;
        stats.cacheReadTokens += parsed.message.usage.cache_read_input_tokens ?? 0;
      }

      // Phase 7: isSidechain tracking
      if ((parsed.type === 'assistant' || parsed.type === 'user') && parsed.isSidechain) {
        stats.sidechainMessages++;
      }

      // Detect tool_use blocks
      if (parsed.type === 'assistant' && Array.isArray(parsed.message?.content)) {
        for (const block of parsed.message.content) {
          if (block.type === 'tool_use' && block.name) {
            stats.totalToolCalls++;
            const current = stats.toolCounts.get(block.name) || 0;
            stats.toolCounts.set(block.name, current + 1);

            // Phase 7: build tool call sequence for anti-pattern detection (capped)
            if (stats.toolCallSequence.length < MAX_TOOL_CALL_SEQUENCE) {
              const event: ToolCallEvent = {
                turnIndex: stats.totalToolCalls,
                toolName: block.name,
                isError: false,
              };
              if (block.name === 'Bash' && block.input?.command) {
                event.bashCommand = block.input.command;
              }
              if ((block.name === 'Read' || block.name === 'Edit' || block.name === 'Write') && block.input?.file_path) {
                event.targetFile = block.input.file_path;
              }
              stats.toolCallSequence.push(event);
            }
          }

          // Phase 7: server_tool_use counting
          if (block.type === 'server_tool_use') {
            stats.serverToolUseCount++;
          }
        }
      }

      // Detect token usage (nested inside message on assistant messages)
      const usage = parsed.message?.usage;
      if (usage) {
        stats.tokenInput += usage.input_tokens || 0;
        stats.tokenOutput += usage.output_tokens || 0;
        stats.tokenCacheRead += usage.cache_read_input_tokens || 0;
        stats.tokenCacheCreation += usage.cache_creation_input_tokens || 0;
      }

      // Detect skill/slash commands in user messages
      if (parsed.type === 'human' && typeof parsed.message?.content === 'string') {
        const content = parsed.message.content.trim();
        if (content.startsWith('/')) {
          const command = content.split(/\s/)[0];
          const current = stats.skillCounts.get(command) || 0;
          stats.skillCounts.set(command, current + 1);
        }
      }

      // Detect errors in tool results
      if (parsed.type === 'tool_result' && parsed.is_error) {
        stats.errorCount++;
      }
      // Also detect tool results within content arrays
      if (parsed.type === 'human' && Array.isArray(parsed.message?.content)) {
        for (const block of parsed.message.content) {
          if (block.type === 'tool_result' && block.is_error) {
            stats.errorCount++;
          }
        }
      }
    });

    rl.on('close', () => {
      resolve(messageCount);
    });

    rl.on('error', (err) => {
      // Gracefully handle read errors (permission denied, etc.)
      console.warn(`[Log Analyzer] Error reading ${filePath}: ${err.message}`);
      resolve(messageCount);
    });

    stream.on('error', (err) => {
      console.warn(`[Log Analyzer] Stream error for ${filePath}: ${err.message}`);
      resolve(messageCount);
    });
  });
}

// ── Stats cache reader ──────────────────────────────────────────────────

/** Real v2 schema of ~/.claude/stats-cache.json */
interface StatsCacheData {
  version: 2;
  lastComputedDate: string;
  dailyActivity: Array<{
    date: string;
    messageCount: number;
    sessionCount: number;
    toolCallCount: number;
  }>;
  dailyModelTokens: Array<{
    date: string;
    tokensByModel: Record<string, number>;
  }>;
  modelUsage: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    webSearchRequests: number;
    costUSD: number;
  }>;
  totalSessions: number;
  totalMessages: number;
  longestSession: { sessionId: string; duration: number; messageCount: number; timestamp: string };
  firstSessionDate: string;
  hourCounts: Record<string, number>;
  totalSpeculationTimeSavedMs: number;
}

/**
 * Read stats-cache.json for daily/model statistics.
 * Parses the real v2 schema; returns null if absent or malformed.
 */
export function readStatsCache(claudeHome?: string): StatsCacheData | null {
  const home = claudeHome ?? getClaudeHome();
  const cachePath = path.join(home, 'stats-cache.json');
  try {
    if (!fs.existsSync(cachePath)) return null;
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    if (raw.version === 2 && raw.modelUsage) return raw as StatsCacheData;
    return null;
  } catch {
    return null;
  }
}

// ── History reader ──────────────────────────────────────────────────────

/**
 * Parse history.jsonl for additional skill/command patterns.
 */
export async function parseHistory(claudeHome?: string): Promise<Map<string, number>> {
  const home = claudeHome ?? getClaudeHome();
  const historyPath = path.join(home, 'history.jsonl');
  const commands = new Map<string, number>();

  if (!fs.existsSync(historyPath)) return commands;

  return new Promise((resolve) => {
    let lineCount = 0;
    const stream = fs.createReadStream(historyPath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      lineCount++;
      if (lineCount > MAX_LINES_PER_FILE) {
        rl.close();
        stream.destroy();
        return;
      }

      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.command && typeof parsed.command === 'string') {
          const cmd = parsed.command.trim();
          if (cmd.startsWith('/')) {
            const command = cmd.split(/\s/)[0];
            const current = commands.get(command) || 0;
            commands.set(command, current + 1);
          }
        }
      } catch {
        // Skip corrupt lines
      }
    });

    rl.on('close', () => resolve(commands));
    rl.on('error', () => resolve(commands));
    stream.on('error', () => resolve(commands));
  });
}

// ── Anti-pattern detection ──────────────────────────────────────────────

/**
 * Detect workflow anti-patterns from ordered tool call sequence.
 * Returns array of occurrences with concrete turn references.
 */
export function detectAntiPatterns(
  sequence: ToolCallEvent[],
  totalToolCalls: number,
  toolCounts: Map<string, number>
): AntiPatternOccurrence[] {
  const occurrences: AntiPatternOccurrence[] = [];

  // 1. Bash-for-file-ops: Bash command contains grep/find/rg/cat/head/tail/sed/awk
  const bashFileOpsPattern = /\b(grep\b|find\s|rg\s|cat\s|head\s|tail\s|sed\s|awk\s)/i;
  for (const event of sequence) {
    if (event.toolName === 'Bash' && event.bashCommand && bashFileOpsPattern.test(event.bashCommand)) {
      occurrences.push({
        pattern: 'bash-for-file-ops',
        turn: event.turnIndex,
        detail: `Bash file-op: "${event.bashCommand.slice(0, 80)}"`,
      });
    }
  }

  // 2. Correction loops: 4+ edits on same file without intervening Read
  const fileEditHistory: Record<string, { editCount: number; lastReadTurn: number }> = {};
  for (const event of sequence) {
    if ((event.toolName === 'Edit' || event.toolName === 'Write') && event.targetFile) {
      const h = fileEditHistory[event.targetFile] ?? { editCount: 0, lastReadTurn: -1 };
      h.editCount++;
      fileEditHistory[event.targetFile] = h;
      if (h.editCount >= 4 && event.turnIndex - h.lastReadTurn > 3) {
        occurrences.push({
          pattern: 'correction-loop',
          turn: event.turnIndex,
          detail: `${h.editCount} Edits auf ${event.targetFile} ohne Read dazwischen`,
        });
        h.editCount = 0; // Reset to avoid duplicate reporting
      }
    }
    if (event.toolName === 'Read' && event.targetFile && fileEditHistory[event.targetFile]) {
      fileEditHistory[event.targetFile].lastReadTurn = event.turnIndex;
      fileEditHistory[event.targetFile].editCount = 0;
    }
  }

  // 3. Kitchen-sink: >200 total tool calls AND >5 distinct tool types
  if (totalToolCalls > 200 && toolCounts.size > 5) {
    occurrences.push({
      pattern: 'kitchen-sink',
      turn: 0,
      detail: `${totalToolCalls} Tool-Calls über ${toolCounts.size} Tool-Typen — Session zu breit gefächert`,
    });
  }

  // 4. Infinite exploration: Read:Edit ratio >10:1 with >50 reads
  const readCount = toolCounts.get('Read') ?? 0;
  const editCount = (toolCounts.get('Edit') ?? 0) + (toolCounts.get('Write') ?? 0);
  if (readCount > 50 && editCount > 0 && readCount / editCount > 10) {
    occurrences.push({
      pattern: 'infinite-exploration',
      turn: 0,
      detail: `Read:Edit Verhältnis ${readCount}:${editCount} — zu viel Erkundung, zu wenig Output`,
    });
  }

  return occurrences;
}

// ── Recommendation engine ───────────────────────────────────────────────

// Bash commands that indicate file-search workaround
const BASH_SEARCH_PATTERNS = ['grep', 'find', 'rg', 'cat', 'head', 'tail', 'sed', 'awk'];

/**
 * Compute recommendations based on aggregated stats.
 * Produces praise, tip, warning, and anti-pattern severity items.
 */
export function computeRecommendations(
  stats: ParsedStats,
  antiPatterns: AntiPatternOccurrence[] = []
): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const totalTools = stats.totalToolCalls || 1; // Prevent division by zero

  // Helper: tool percentage
  const toolPct = (name: string): number => {
    const count = stats.toolCounts.get(name) || 0;
    return (count / totalTools) * 100;
  };

  // Helper: combined percentage for multiple tools
  const toolGroupPct = (names: string[]): number => {
    const sum = names.reduce((acc, n) => acc + (stats.toolCounts.get(n) || 0), 0);
    return (sum / totalTools) * 100;
  };

  const taskPct = toolPct('Task');
  const readPct = toolPct('Read');
  const writePct = toolPct('Write');
  const editPct = toolPct('Edit');
  const grepPct = toolPct('Grep');
  const globPct = toolPct('Glob');
  const bashPct = toolPct('Bash');

  // Cache hit ratio
  const totalTokenInput = stats.tokenInput + stats.tokenCacheRead + stats.tokenCacheCreation;
  const cacheHitRatio = totalTokenInput > 0
    ? (stats.tokenCacheRead / totalTokenInput) * 100
    : 0;

  // Error rate
  const errorRate = stats.totalMessages > 0
    ? (stats.errorCount / stats.totalMessages) * 100
    : 0;

  // Count bash searches (rough heuristic: bash is used for search patterns)
  const bashSearchCount = stats.toolCounts.get('Bash') || 0;
  const nativeSearchCount = (stats.toolCounts.get('Grep') || 0) + (stats.toolCounts.get('Glob') || 0);

  // ── Praise rules ──

  if (taskPct > 15) {
    recommendations.push({
      severity: 'praise',
      title: 'Starker Subagent-Einsatz!',
      description: 'Task-Tool wird intensiv genutzt, um Arbeit zu parallelisieren und zu delegieren.',
      metric: `Task: ${taskPct.toFixed(1)}% aller Tool-Aufrufe`,
    });
  }

  if (cacheHitRatio > 85) {
    recommendations.push({
      severity: 'praise',
      title: 'Exzellente Context-Wiederverwendung.',
      description: 'Cache-Hit-Rate ist hoch — wenig redundante Token-Generierung.',
      metric: `Cache-Hit: ${cacheHitRatio.toFixed(1)}%`,
    });
  }

  if (readPct > 20) {
    recommendations.push({
      severity: 'praise',
      title: 'Guter Read-Before-Write-Workflow.',
      description: 'Read-Tool wird haeufig vor Write/Edit eingesetzt — sauberer Arbeitsstil.',
      metric: `Read: ${readPct.toFixed(1)}%`,
    });
  }

  if (nativeSearchCount > bashSearchCount && nativeSearchCount > 0) {
    recommendations.push({
      severity: 'praise',
      title: 'Saubere Tool-Nutzung.',
      description: 'Grep+Glob werden haeufiger genutzt als Bash-Suchen — native Tools bevorzugt.',
      metric: `Native: ${nativeSearchCount}, Bash: ${bashSearchCount}`,
    });
  }

  // GSD skills detection
  const gsdSkills = ['/gsd', '/gsd:plan', '/gsd:execute', '/gsd:execute-phase'];
  const hasGsdSkills = gsdSkills.some(s => stats.skillCounts.has(s));
  if (hasGsdSkills) {
    recommendations.push({
      severity: 'praise',
      title: 'Orchestrator-Skills im Einsatz!',
      description: 'GSD-Workflow-Skills werden aktiv genutzt fuer strukturierte Ausfuehrung.',
    });
  }

  // EnterPlanMode detection
  if (stats.skillCounts.has('/plan') || stats.skillCounts.has('/EnterPlanMode')) {
    recommendations.push({
      severity: 'praise',
      title: 'Plan-Mode wird aktiv genutzt.',
      description: 'Planung vor Ausfuehrung — ein Zeichen fuer durchdachte Arbeitsweise.',
    });
  }

  // ── Improvement rules ──

  if (cacheHitRatio < 70 && totalTokenInput > 0) {
    recommendations.push({
      severity: 'warning',
      title: 'Context wird haeufig neu aufgebaut.',
      description: 'Niedrige Cache-Hit-Rate — Sessions oder Prompts werden nicht effizient wiederverwendet.',
      metric: `Cache-Hit: ${cacheHitRatio.toFixed(1)}%`,
    });
  }

  if (!stats.toolCounts.has('Task') && stats.totalToolCalls > 10) {
    recommendations.push({
      severity: 'tip',
      title: 'Subagents nicht genutzt.',
      description: 'Das Task-Tool wird nicht eingesetzt. Subagents koennen parallele Arbeit beschleunigen.',
    });
  }

  // Bash used for file-search (heuristic: bash > 20% and search tools underused)
  if (bashPct > 20 && nativeSearchCount < bashSearchCount) {
    recommendations.push({
      severity: 'warning',
      title: 'Bash fuer Datei-Suche.',
      description: 'Bash wird haeufig statt Grep/Glob verwendet. Native Tools sind praeziser und schneller.',
      metric: `Bash: ${bashPct.toFixed(1)}%, Grep+Glob: ${toolGroupPct(['Grep', 'Glob']).toFixed(1)}%`,
    });
  }

  if (errorRate > 10) {
    recommendations.push({
      severity: 'warning',
      title: 'Hohe Fehlerrate.',
      description: 'Mehr als 10% der Interaktionen fuehren zu Fehlern. Ursachen pruefen.',
      metric: `Fehlerrate: ${errorRate.toFixed(1)}%`,
    });
  }

  if (stats.skillCounts.size === 0 && stats.totalMessages > 20) {
    recommendations.push({
      severity: 'tip',
      title: 'Keine Slash-Commands.',
      description: 'Skills und Slash-Commands werden nicht genutzt. Diese koennen Workflows beschleunigen.',
    });
  }

  if (readPct < 5 && (writePct + editPct) > 20) {
    recommendations.push({
      severity: 'warning',
      title: 'Wenig Read vor Write.',
      description: 'Files werden haeufig geschrieben/editiert ohne vorheriges Lesen — Risiko fuer Kontextverlust.',
      metric: `Read: ${readPct.toFixed(1)}%, Write+Edit: ${(writePct + editPct).toFixed(1)}%`,
    });
  }

  if (stats.maxMessagesInSession > 500) {
    recommendations.push({
      severity: 'warning',
      title: 'Sehr lange Sessions.',
      description: 'Sessions mit ueber 500 Nachrichten — kuerzere Sessions verbessern Fokus und Cache-Effizienz.',
      metric: `Laengste Session: ${stats.maxMessagesInSession} Nachrichten`,
    });
  }

  // ── Anti-pattern recommendations ──
  for (const ap of antiPatterns) {
    if (ap.pattern === 'bash-for-file-ops') {
      recommendations.push({
        severity: 'anti-pattern',
        title: 'Bash statt nativer File-Tools.',
        description: `Verwende Grep/Glob/Read statt Bash-Datei-Operationen — schneller und zeigt Ergebnisse direkt in der UI. Turn ${ap.turn}: ${ap.detail}`,
      });
    } else if (ap.pattern === 'correction-loop') {
      recommendations.push({
        severity: 'anti-pattern',
        title: 'Correction-Loop erkannt.',
        description: `Mehrfache Edits ohne Read zwischendurch — lies die Datei vor weiteren Aenderungen. ${ap.detail}`,
      });
    } else if (ap.pattern === 'kitchen-sink') {
      recommendations.push({
        severity: 'anti-pattern',
        title: 'Kitchen-Sink-Session.',
        description: `${ap.detail} — fokussiere auf kleinere, klar abgegrenzte Aufgaben pro Session.`,
      });
    } else if (ap.pattern === 'infinite-exploration') {
      recommendations.push({
        severity: 'anti-pattern',
        title: 'Infinite-Exploration.',
        description: `${ap.detail} — setze klare Outputs bevor du weiter erkundest.`,
      });
    }
  }

  return recommendations;
}

// ── Session scoring ─────────────────────────────────────────────────────

/**
 * Compute a per-session 0-100 practice score with badges and full detail.
 * Returns SessionScoreDetail including anti-pattern detection, sub-scores, and new fields.
 */
export async function computeSessionScore(sessionPath: string): Promise<SessionScoreDetail> {
  const sessionId = path.basename(sessionPath, '.jsonl');
  const stats = emptyStats();

  // Resolve the full path if only a session ID was given
  let fullPath = sessionPath;
  if (!sessionPath.endsWith('.jsonl')) {
    // Search for the session file
    const files = discoverSessionFiles();
    const found = files.find(f => path.basename(f, '.jsonl') === sessionPath);
    if (found) {
      fullPath = found;
    } else {
      return {
        sessionId,
        score: 0,
        badges: [],
        highlights: ['Session not found'],
        toolNativenessScore: 0,
        subagentScore: 0,
        readBeforeWriteScore: 0,
        contextEfficiencyScore: 0,
        errorScore: 0,
        antiPatterns: [],
        recommendations: [],
        avgTurnDurationMs: 0,
        compactBoundaryCount: 0,
        modelUsed: null,
        apiErrorCount: 0,
        serverToolUseCount: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      };
    }
  }

  if (!fs.existsSync(fullPath)) {
    return {
      sessionId,
      score: 0,
      badges: [],
      highlights: ['Session file not found'],
      toolNativenessScore: 0,
      subagentScore: 0,
      readBeforeWriteScore: 0,
      contextEfficiencyScore: 0,
      errorScore: 0,
      antiPatterns: [],
      recommendations: [],
      avgTurnDurationMs: 0,
      compactBoundaryCount: 0,
      modelUsed: null,
      apiErrorCount: 0,
      serverToolUseCount: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };
  }

  await parseJsonlFile(fullPath, stats);

  const totalTools = stats.totalToolCalls || 1;
  const toolPct = (name: string): number => ((stats.toolCounts.get(name) || 0) / totalTools) * 100;

  const taskPct = toolPct('Task');
  const readPct = toolPct('Read');
  const writePct = toolPct('Write');
  const editPct = toolPct('Edit');
  const grepPct = toolPct('Grep');
  const globPct = toolPct('Glob');
  const bashPct = toolPct('Bash');

  const totalTokenInput = stats.tokenInput + stats.tokenCacheRead + stats.tokenCacheCreation;
  const cacheHitRatio = totalTokenInput > 0 ? (stats.tokenCacheRead / totalTokenInput) * 100 : 50;
  const errorRate = stats.totalMessages > 0 ? (stats.errorCount / stats.totalMessages) * 100 : 0;

  // ── Score components (weighted 0-100) ──

  // Tool-Nativeness: 25% (Grep/Glob/Read vs Bash equivalents)
  const nativeTools = (stats.toolCounts.get('Grep') || 0) + (stats.toolCounts.get('Glob') || 0) + (stats.toolCounts.get('Read') || 0);
  const bashCount = stats.toolCounts.get('Bash') || 0;
  const nativeRatio = (nativeTools + bashCount) > 0 ? nativeTools / (nativeTools + bashCount) : 0.5;
  const toolNativenessScore = Math.min(100, nativeRatio * 100);

  // Subagent-Nutzung: 20% (Task tool share)
  const subagentScore = Math.min(100, taskPct * 5); // 20% Task → 100 score

  // Read-before-Write: 20% (Read vs Write/Edit ratio)
  const writeEditCount = (stats.toolCounts.get('Write') || 0) + (stats.toolCounts.get('Edit') || 0);
  const readCount = stats.toolCounts.get('Read') || 0;
  const readWriteRatio = (readCount + writeEditCount) > 0 ? readCount / (readCount + writeEditCount) : 0.5;
  const readBeforeWriteScore = Math.min(100, readWriteRatio * 200); // 50% ratio → 100 score

  // Context-Effizienz: 20% (Cache-hit ratio)
  const contextEfficiencyScore = Math.min(100, cacheHitRatio * 1.18); // 85% → 100 score

  // Error-Rate: 15% (inverse error rate)
  const errorScore = Math.max(0, 100 - errorRate * 10); // 10% error → 0 score

  // Weighted total
  const score = Math.round(
    toolNativenessScore * 0.25 +
    subagentScore * 0.20 +
    readBeforeWriteScore * 0.20 +
    contextEfficiencyScore * 0.20 +
    errorScore * 0.15
  );

  // ── Anti-pattern detection ──
  const antiPatterns = detectAntiPatterns(stats.toolCallSequence, stats.totalToolCalls, stats.toolCounts);

  // ── Recommendations (includes anti-pattern recommendations) ──
  const recommendations = computeRecommendations(stats, antiPatterns);

  // ── Badges ──
  const badges: string[] = [];
  if (taskPct > 15) badges.push('Subagent Pro');
  if (bashCount === 0 || nativeRatio > 0.9) badges.push('Tool Native');
  if (cacheHitRatio > 85) badges.push('Context Efficient');
  if (stats.skillCounts.has('/plan') || stats.skillCounts.has('/EnterPlanMode')) badges.push('Planned');
  const gsdSkills = ['/gsd', '/gsd:plan', '/gsd:execute', '/gsd:execute-phase'];
  if (gsdSkills.some(s => stats.skillCounts.has(s))) badges.push('Orchestrated');

  // ── Highlights ──
  const highlights: string[] = [];
  if (score >= 80) highlights.push('Excellent practice score');
  if (badges.length > 0) highlights.push(`Badges earned: ${badges.join(', ')}`);
  if (stats.totalToolCalls > 0) highlights.push(`${stats.totalToolCalls} tool calls across session`);

  // ── Phase 7 new fields ──
  const avgTurnDurationMs = stats.turnDurations.length > 0
    ? Math.round(stats.turnDurations.reduce((a, b) => a + b, 0) / stats.turnDurations.length)
    : 0;

  return {
    sessionId,
    score: Math.min(100, Math.max(0, score)),
    badges,
    highlights,
    toolNativenessScore,
    subagentScore,
    readBeforeWriteScore,
    contextEfficiencyScore,
    errorScore,
    antiPatterns,
    recommendations,
    avgTurnDurationMs,
    compactBoundaryCount: stats.compactBoundaryCount,
    modelUsed: stats.modelUsed,
    apiErrorCount: stats.apiErrorCount,
    serverToolUseCount: stats.serverToolUseCount,
    cacheCreationTokens: stats.cacheCreationTokens,
    cacheReadTokens: stats.cacheReadTokens,
  };
}

// ── Main entry point ────────────────────────────────────────────────────

/**
 * Analyze all Claude CLI sessions. Returns cached result if < 5 minutes old.
 */
export async function analyzeAllSessions(): Promise<SessionAnalysis> {
  // Check cache
  if (cachedResult && (Date.now() - cachedAt) < CACHE_TTL_MS) {
    console.log('[Log Analyzer] Returning cached analysis');
    return cachedResult;
  }

  console.log('[Log Analyzer] Starting full analysis...');
  const stats = emptyStats();

  // 1. Discover and parse session JSONL files
  const files = discoverSessionFiles();
  stats.sessionCount = files.length;

  for (const file of files) {
    const messageCount = await parseJsonlFile(file, stats);
    stats.totalMessages += messageCount;
    if (messageCount > stats.maxMessagesInSession) {
      stats.maxMessagesInSession = messageCount;
    }
  }

  // 2. Read stats cache for additional context (v2 schema)
  // Note: token data is read directly from JSONL above; stats-cache is supplemental
  const statsCacheData = readStatsCache();
  // (statsCacheData available for future use — e.g., model usage stats)

  // 3. Parse history for skill patterns
  const historySkills = await parseHistory();
  for (const [cmd, count] of Array.from(historySkills)) {
    const existing = stats.skillCounts.get(cmd) || 0;
    stats.skillCounts.set(cmd, existing + count);
  }

  // 4. Build result
  const totalToolCalls = stats.totalToolCalls || 1;
  const toolUsage: ToolUsageStat[] = Array.from(stats.toolCounts.entries())
    .map(([name, count]) => ({
      name,
      count,
      percentage: parseFloat(((count / totalToolCalls) * 100).toFixed(1)),
    }))
    .sort((a, b) => b.count - a.count);

  const skillUsage: SkillUsageStat[] = Array.from(stats.skillCounts.entries())
    .map(([command, count]) => ({ command, count }))
    .sort((a, b) => b.count - a.count);

  const totalTokenInput = stats.tokenInput + stats.tokenCacheRead + stats.tokenCacheCreation;
  const tokenUsage: TokenUsage = {
    totalInput: stats.tokenInput,
    totalOutput: stats.tokenOutput,
    totalCacheRead: stats.tokenCacheRead,
    totalCacheCreation: stats.tokenCacheCreation,
    cacheHitRatio: totalTokenInput > 0
      ? parseFloat(((stats.tokenCacheRead / totalTokenInput) * 100).toFixed(1))
      : 0,
  };

  const overview: AnalysisOverview = {
    totalSessions: stats.sessionCount,
    totalMessages: stats.totalMessages,
    totalToolCalls: stats.totalToolCalls,
    dateRange: {
      from: stats.earliestDate || 'N/A',
      to: stats.latestDate || 'N/A',
    },
  };

  const problems: Problem[] = [];
  if (stats.errorCount > 0) {
    problems.push({
      type: 'tool_errors',
      message: `${stats.errorCount} tool execution errors detected`,
      count: stats.errorCount,
    });
  }

  const recommendations = computeRecommendations(stats);

  // Compute overall practice score (average of hypothetical session scores)
  const scoreResult = computeOverallScore(stats);

  const result: SessionAnalysis = {
    overview,
    toolUsage,
    skillUsage,
    tokenUsage,
    problems,
    recommendations,
    practiceScore: scoreResult,
  };

  // Cache the result
  cachedResult = result;
  cachedAt = Date.now();

  console.log(`[Log Analyzer] Analysis complete: ${stats.sessionCount} sessions, ${stats.totalToolCalls} tool calls`);
  return result;
}

/**
 * Compute overall practice score from aggregated stats.
 */
function computeOverallScore(stats: ParsedStats): number {
  const totalTools = stats.totalToolCalls || 1;
  const toolPct = (name: string): number => ((stats.toolCounts.get(name) || 0) / totalTools) * 100;

  const taskPct = toolPct('Task');
  const nativeTools = (stats.toolCounts.get('Grep') || 0) + (stats.toolCounts.get('Glob') || 0) + (stats.toolCounts.get('Read') || 0);
  const bashCount = stats.toolCounts.get('Bash') || 0;
  const nativeRatio = (nativeTools + bashCount) > 0 ? nativeTools / (nativeTools + bashCount) : 0.5;
  const readCount = stats.toolCounts.get('Read') || 0;
  const writeEditCount = (stats.toolCounts.get('Write') || 0) + (stats.toolCounts.get('Edit') || 0);
  const readWriteRatio = (readCount + writeEditCount) > 0 ? readCount / (readCount + writeEditCount) : 0.5;

  const totalTokenInput = stats.tokenInput + stats.tokenCacheRead + stats.tokenCacheCreation;
  const cacheHitRatio = totalTokenInput > 0 ? (stats.tokenCacheRead / totalTokenInput) * 100 : 50;
  const errorRate = stats.totalMessages > 0 ? (stats.errorCount / stats.totalMessages) * 100 : 0;

  const toolNativenessScore = Math.min(100, nativeRatio * 100);
  const subagentScore = Math.min(100, taskPct * 5);
  const readBeforeWriteScore = Math.min(100, readWriteRatio * 200);
  const contextScore = Math.min(100, cacheHitRatio * 1.18);
  const errorScore = Math.max(0, 100 - errorRate * 10);

  const score = Math.round(
    toolNativenessScore * 0.25 +
    subagentScore * 0.20 +
    readBeforeWriteScore * 0.20 +
    contextScore * 0.20 +
    errorScore * 0.15
  );

  return Math.min(100, Math.max(0, score));
}

/**
 * Clear the analysis cache (exposed for testing).
 */
export function clearCache(): void {
  cachedResult = null;
  cachedAt = 0;
}
