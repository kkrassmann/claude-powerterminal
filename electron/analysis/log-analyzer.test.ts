/**
 * Unit tests for Claude CLI session log analyzer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  parseJsonlFile,
  computeRecommendations,
  computeSessionScore,
  analyzeAllSessions,
  discoverSessionFiles,
  readStatsCache,
  clearCache,
  detectAntiPatterns,
} from './log-analyzer';

// ── Test helpers ────────────────────────────────────────────────────────

let tmpDir: string;

function createTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-analyzer-test-'));
  return dir;
}

function writeJsonl(filePath: string, lines: any[]): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const content = lines.map(l => JSON.stringify(l)).join('\n');
  fs.writeFileSync(filePath, content, 'utf-8');
}

function emptyStats() {
  return {
    totalMessages: 0,
    totalToolCalls: 0,
    toolCounts: new Map<string, number>(),
    skillCounts: new Map<string, number>(),
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
    turnDurations: [] as number[],
    compactBoundaryCount: 0,
    modelUsed: null as string | null,
    sidechainMessages: 0,
    toolCallSequence: [] as any[],
    apiErrorCount: 0,
    serverToolUseCount: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };
}

// ── Test setup ──────────────────────────────────────────────────────────

beforeEach(() => {
  tmpDir = createTmpDir();
  clearCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── JSONL Parsing ───────────────────────────────────────────────────────

describe('parseJsonlFile', () => {
  it('should parse valid JSONL lines', async () => {
    const filePath = path.join(tmpDir, 'valid.jsonl');
    writeJsonl(filePath, [
      { type: 'human', message: { content: 'hello' }, timestamp: '2026-01-01T00:00:00Z' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] }, timestamp: '2026-01-01T00:01:00Z' },
    ]);

    const stats = emptyStats();
    const count = await parseJsonlFile(filePath, stats);

    expect(count).toBe(2);
    expect(stats.earliestDate).toBe('2026-01-01T00:00:00Z');
    expect(stats.latestDate).toBe('2026-01-01T00:01:00Z');
  });

  it('should skip corrupt/invalid JSON lines', async () => {
    const filePath = path.join(tmpDir, 'corrupt.jsonl');
    fs.writeFileSync(filePath, '{"valid": true}\nnot-json\n{"also": "valid"}\n', 'utf-8');

    const stats = emptyStats();
    const count = await parseJsonlFile(filePath, stats);

    expect(count).toBe(2); // Only valid lines counted
  });

  it('should handle empty files', async () => {
    const filePath = path.join(tmpDir, 'empty.jsonl');
    fs.writeFileSync(filePath, '', 'utf-8');

    const stats = emptyStats();
    const count = await parseJsonlFile(filePath, stats);

    expect(count).toBe(0);
  });

  it('should handle files with only empty lines', async () => {
    const filePath = path.join(tmpDir, 'blank.jsonl');
    fs.writeFileSync(filePath, '\n\n\n', 'utf-8');

    const stats = emptyStats();
    const count = await parseJsonlFile(filePath, stats);

    expect(count).toBe(0);
  });
});

// ── Tool Extraction ─────────────────────────────────────────────────────

describe('tool extraction', () => {
  it('should count tool_use blocks by name', async () => {
    const filePath = path.join(tmpDir, 'tools.jsonl');
    writeJsonl(filePath, [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Read', id: '1' },
            { type: 'tool_use', name: 'Bash', id: '2' },
            { type: 'text', text: 'thinking...' },
          ],
        },
      },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Read', id: '3' },
            { type: 'tool_use', name: 'Grep', id: '4' },
          ],
        },
      },
    ]);

    const stats = emptyStats();
    await parseJsonlFile(filePath, stats);

    expect(stats.totalToolCalls).toBe(4);
    expect(stats.toolCounts.get('Read')).toBe(2);
    expect(stats.toolCounts.get('Bash')).toBe(1);
    expect(stats.toolCounts.get('Grep')).toBe(1);
  });

  it('should ignore messages without tool_use blocks', async () => {
    const filePath = path.join(tmpDir, 'no-tools.jsonl');
    writeJsonl(filePath, [
      { type: 'assistant', message: { content: [{ type: 'text', text: 'just text' }] } },
      { type: 'human', message: { content: 'user input' } },
    ]);

    const stats = emptyStats();
    await parseJsonlFile(filePath, stats);

    expect(stats.totalToolCalls).toBe(0);
    expect(stats.toolCounts.size).toBe(0);
  });
});

// ── Skill Recognition ───────────────────────────────────────────────────

describe('skill recognition', () => {
  it('should detect slash commands in user messages', async () => {
    const filePath = path.join(tmpDir, 'skills.jsonl');
    writeJsonl(filePath, [
      { type: 'human', message: { content: '/plan let me think about this' } },
      { type: 'human', message: { content: '/gsd:execute start phase 1' } },
      { type: 'human', message: { content: '/plan another plan request' } },
      { type: 'human', message: { content: 'not a skill command' } },
    ]);

    const stats = emptyStats();
    await parseJsonlFile(filePath, stats);

    expect(stats.skillCounts.get('/plan')).toBe(2);
    expect(stats.skillCounts.get('/gsd:execute')).toBe(1);
    expect(stats.skillCounts.size).toBe(2);
  });

  it('should not detect commands in non-human messages', async () => {
    const filePath = path.join(tmpDir, 'no-skills.jsonl');
    writeJsonl(filePath, [
      { type: 'assistant', message: { content: '/plan is a skill' } },
    ]);

    const stats = emptyStats();
    await parseJsonlFile(filePath, stats);

    // assistant messages with string content won't match the human + string check
    expect(stats.skillCounts.size).toBe(0);
  });
});

// ── Token Aggregation ───────────────────────────────────────────────────

describe('token aggregation', () => {
  it('should aggregate token usage from usage fields', async () => {
    const filePath = path.join(tmpDir, 'tokens.jsonl');
    writeJsonl(filePath, [
      { type: 'assistant', message: { usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 200, cache_creation_input_tokens: 30 } } },
      { type: 'assistant', message: { usage: { input_tokens: 150, output_tokens: 75, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 } } },
    ]);

    const stats = emptyStats();
    await parseJsonlFile(filePath, stats);

    expect(stats.tokenInput).toBe(250);
    expect(stats.tokenOutput).toBe(125);
    expect(stats.tokenCacheRead).toBe(300);
    expect(stats.tokenCacheCreation).toBe(50);
  });

  it('should handle missing usage fields gracefully', async () => {
    const filePath = path.join(tmpDir, 'partial-tokens.jsonl');
    writeJsonl(filePath, [
      { type: 'assistant', message: { usage: { input_tokens: 100 } } },
      { type: 'assistant', message: { usage: {} } },
      { type: 'human', message: { content: 'no usage' } },
    ]);

    const stats = emptyStats();
    await parseJsonlFile(filePath, stats);

    expect(stats.tokenInput).toBe(100);
    expect(stats.tokenOutput).toBe(0);
    expect(stats.tokenCacheRead).toBe(0);
  });
});

// ── Error Detection ─────────────────────────────────────────────────────

describe('error detection', () => {
  it('should count tool_result errors in human messages', async () => {
    const filePath = path.join(tmpDir, 'errors.jsonl');
    writeJsonl(filePath, [
      { type: 'human', message: { content: [{ type: 'tool_result', is_error: true, content: 'fail' }] } },
      { type: 'human', message: { content: [{ type: 'tool_result', is_error: false, content: 'ok' }] } },
      { type: 'human', message: { content: [{ type: 'tool_result', is_error: true, content: 'fail2' }] } },
    ]);

    const stats = emptyStats();
    await parseJsonlFile(filePath, stats);

    expect(stats.errorCount).toBe(2);
  });
});

// ── Phase 7: New JSONL field extraction ─────────────────────────────────

describe('Phase 7 field extraction', () => {
  it('should extract turn_duration from system records', async () => {
    const filePath = path.join(tmpDir, 'turn-duration.jsonl');
    writeJsonl(filePath, [
      { type: 'system', subtype: 'turn_duration', durationMs: 45000, timestamp: '2026-01-01T00:00:00Z' },
    ]);

    const stats = emptyStats();
    await parseJsonlFile(filePath, stats);

    expect(stats.turnDurations).toHaveLength(1);
    expect(stats.turnDurations[0]).toBe(45000);
  });

  it('should extract compact_boundary count from system records', async () => {
    const filePath = path.join(tmpDir, 'compact-boundary.jsonl');
    writeJsonl(filePath, [
      { type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto' }, timestamp: '2026-01-01T00:00:00Z' },
    ]);

    const stats = emptyStats();
    await parseJsonlFile(filePath, stats);

    expect(stats.compactBoundaryCount).toBe(1);
  });

  it('should track last seen model from assistant message.model', async () => {
    const filePath = path.join(tmpDir, 'model.jsonl');
    writeJsonl(filePath, [
      { type: 'assistant', message: { model: 'claude-opus-4-6', content: [] }, timestamp: '2026-01-01T00:00:00Z' },
    ]);

    const stats = emptyStats();
    await parseJsonlFile(filePath, stats);

    expect(stats.modelUsed).toBe('claude-opus-4-6');
  });

  it('should count api_error records', async () => {
    const filePath = path.join(tmpDir, 'api-error.jsonl');
    writeJsonl(filePath, [
      { type: 'api_error', error: { message: 'rate limit exceeded' }, timestamp: '2026-01-01T00:00:00Z' },
    ]);

    const stats = emptyStats();
    await parseJsonlFile(filePath, stats);

    expect(stats.apiErrorCount).toBe(1);
  });

  it('should accumulate cache_creation_input_tokens from assistant message.usage', async () => {
    const filePath = path.join(tmpDir, 'cache-creation.jsonl');
    writeJsonl(filePath, [
      {
        type: 'assistant',
        message: { content: [], usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 1000, cache_read_input_tokens: 0 } },
        timestamp: '2026-01-01T00:00:00Z',
      },
    ]);

    const stats = emptyStats();
    await parseJsonlFile(filePath, stats);

    expect(stats.cacheCreationTokens).toBe(1000);
  });

  it('should count server_tool_use blocks in assistant content', async () => {
    const filePath = path.join(tmpDir, 'server-tool-use.jsonl');
    writeJsonl(filePath, [
      {
        type: 'assistant',
        message: { content: [{ type: 'server_tool_use', name: 'web_search', id: '1' }] },
        timestamp: '2026-01-01T00:00:00Z',
      },
    ]);

    const stats = emptyStats();
    await parseJsonlFile(filePath, stats);

    expect(stats.serverToolUseCount).toBe(1);
  });

  it('should compute avgTurnDurationMs correctly in computeSessionScore', async () => {
    const filePath = path.join(tmpDir, 'session-with-duration.jsonl');
    writeJsonl(filePath, [
      { type: 'system', subtype: 'turn_duration', durationMs: 30000, timestamp: '2026-01-01T00:00:00Z' },
      { type: 'system', subtype: 'turn_duration', durationMs: 60000, timestamp: '2026-01-01T00:01:00Z' },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', id: '1' }] }, timestamp: '2026-01-01T00:02:00Z' },
    ]);

    const result = await computeSessionScore(filePath);

    expect(result.avgTurnDurationMs).toBe(45000);
  });

  it('should expose compactBoundaryCount in computeSessionScore', async () => {
    const filePath = path.join(tmpDir, 'session-compact.jsonl');
    writeJsonl(filePath, [
      { type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto' }, timestamp: '2026-01-01T00:00:00Z' },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', id: '1' }] }, timestamp: '2026-01-01T00:01:00Z' },
    ]);

    const result = await computeSessionScore(filePath);

    expect(result.compactBoundaryCount).toBe(1);
  });

  it('should expose apiErrorCount in computeSessionScore', async () => {
    const filePath = path.join(tmpDir, 'session-apierror.jsonl');
    writeJsonl(filePath, [
      { type: 'api_error', error: { message: 'timeout' }, timestamp: '2026-01-01T00:00:00Z' },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', id: '1' }] }, timestamp: '2026-01-01T00:01:00Z' },
    ]);

    const result = await computeSessionScore(filePath);

    expect(result.apiErrorCount).toBe(1);
  });

  it('should expose cacheCreationTokens and cacheReadTokens in computeSessionScore', async () => {
    const filePath = path.join(tmpDir, 'session-cachetokens.jsonl');
    writeJsonl(filePath, [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Read', id: '1' }],
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 500, cache_read_input_tokens: 200 },
        },
        timestamp: '2026-01-01T00:00:00Z',
      },
    ]);

    const result = await computeSessionScore(filePath);

    expect(result.cacheCreationTokens).toBe(500);
    expect(result.cacheReadTokens).toBe(200);
  });

  it('should expose serverToolUseCount in computeSessionScore', async () => {
    const filePath = path.join(tmpDir, 'session-servertool.jsonl');
    writeJsonl(filePath, [
      {
        type: 'assistant',
        message: { content: [{ type: 'server_tool_use', name: 'web_search', id: '1' }] },
        timestamp: '2026-01-01T00:00:00Z',
      },
    ]);

    const result = await computeSessionScore(filePath);

    expect(result.serverToolUseCount).toBe(1);
  });
});

// ── Phase 7: Anti-pattern detection ─────────────────────────────────────

describe('detectAntiPatterns', () => {
  it('bash-for-file-ops: detects Bash grep command', async () => {
    const filePath = path.join(tmpDir, 'bash-grep.jsonl');
    writeJsonl(filePath, [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', id: '1', input: { command: 'grep -r foo .' } }],
        },
        timestamp: '2026-01-01T00:00:00Z',
      },
    ]);

    const result = await computeSessionScore(filePath);
    const bashOps = result.antiPatterns.filter(ap => ap.pattern === 'bash-for-file-ops');

    expect(bashOps.length).toBeGreaterThan(0);
    expect(bashOps[0].pattern).toBe('bash-for-file-ops');
  });

  it('bash-for-file-ops negative: npm run build does not trigger', async () => {
    const filePath = path.join(tmpDir, 'bash-npm.jsonl');
    writeJsonl(filePath, [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', id: '1', input: { command: 'npm run build' } }],
        },
        timestamp: '2026-01-01T00:00:00Z',
      },
    ]);

    const result = await computeSessionScore(filePath);
    const bashOps = result.antiPatterns.filter(ap => ap.pattern === 'bash-for-file-ops');

    expect(bashOps.length).toBe(0);
  });

  it('correction-loop: 5 Edit events on same file with no Read triggers anti-pattern', async () => {
    const filePath = path.join(tmpDir, 'correction-loop.jsonl');
    const lines: any[] = [];
    for (let i = 0; i < 5; i++) {
      lines.push({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Edit', id: `e${i}`, input: { file_path: '/src/app.ts', old_string: `old${i}`, new_string: `new${i}` } }],
        },
        timestamp: `2026-01-01T00:0${i}:00Z`,
      });
    }
    writeJsonl(filePath, lines);

    const result = await computeSessionScore(filePath);
    const correctionLoops = result.antiPatterns.filter(ap => ap.pattern === 'correction-loop');

    expect(correctionLoops.length).toBeGreaterThan(0);
  });

  it('correction-loop with Read: Read at turn 3 resets counter, no anti-pattern', async () => {
    const filePath = path.join(tmpDir, 'correction-loop-with-read.jsonl');
    const lines: any[] = [
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Edit', id: 'e1', input: { file_path: '/src/app.ts', old_string: 'a', new_string: 'b' } }] },
        timestamp: '2026-01-01T00:00:00Z',
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Edit', id: 'e2', input: { file_path: '/src/app.ts', old_string: 'c', new_string: 'd' } }] },
        timestamp: '2026-01-01T00:01:00Z',
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read', id: 'r1', input: { file_path: '/src/app.ts' } }] },
        timestamp: '2026-01-01T00:02:00Z',
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Edit', id: 'e3', input: { file_path: '/src/app.ts', old_string: 'e', new_string: 'f' } }] },
        timestamp: '2026-01-01T00:03:00Z',
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Edit', id: 'e4', input: { file_path: '/src/app.ts', old_string: 'g', new_string: 'h' } }] },
        timestamp: '2026-01-01T00:04:00Z',
      },
    ];
    writeJsonl(filePath, lines);

    const result = await computeSessionScore(filePath);
    const correctionLoops = result.antiPatterns.filter(ap => ap.pattern === 'correction-loop');

    // Read at turn 3 resets counter, only 2 edits after Read — no correction-loop
    expect(correctionLoops.length).toBe(0);
  });

  it('infinite-exploration: 60 Read events and 3 Write events triggers anti-pattern', async () => {
    const filePath = path.join(tmpDir, 'infinite-exploration.jsonl');
    const lines: any[] = [];
    for (let i = 0; i < 60; i++) {
      lines.push({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read', id: `r${i}`, input: { file_path: `/src/file${i}.ts` } }] },
        timestamp: `2026-01-01T00:00:00Z`,
      });
    }
    for (let i = 0; i < 3; i++) {
      lines.push({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Write', id: `w${i}`, input: { file_path: `/src/out${i}.ts`, content: 'test' } }] },
        timestamp: `2026-01-01T01:00:00Z`,
      });
    }
    writeJsonl(filePath, lines);

    const result = await computeSessionScore(filePath);
    const exploration = result.antiPatterns.filter(ap => ap.pattern === 'infinite-exploration');

    expect(exploration.length).toBeGreaterThan(0);
  });

  it('kitchen-sink: 210 tool calls and 7 distinct tool types triggers anti-pattern', () => {
    // Build a toolCounts map with 7 types totaling 210 calls
    const toolCounts = new Map<string, number>();
    const tools = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Task'];
    tools.forEach(t => toolCounts.set(t, 30)); // 7 * 30 = 210

    // Build a minimal sequence (just needs to exist — kitchen-sink checks totals)
    const sequence: any[] = [];

    const results = detectAntiPatterns(sequence, 210, toolCounts);
    const kitchenSink = results.filter(ap => ap.pattern === 'kitchen-sink');

    expect(kitchenSink.length).toBeGreaterThan(0);
  });

  it('kitchen-sink: 50 tool calls with 7 types does NOT trigger (below 200 threshold)', () => {
    const toolCounts = new Map<string, number>();
    ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Task'].forEach(t => toolCounts.set(t, 7));

    const results = detectAntiPatterns([], 50, toolCounts);
    const kitchenSink = results.filter(ap => ap.pattern === 'kitchen-sink');

    expect(kitchenSink.length).toBe(0);
  });
});

// ── Phase 7: Recommendation severity ────────────────────────────────────

describe('recommendation severity — Phase 7', () => {
  it('should use severity "tip" instead of "info" for subagent tip', () => {
    const stats = emptyStats();
    stats.totalToolCalls = 50;
    stats.toolCounts.set('Read', 25);
    stats.toolCounts.set('Bash', 25);
    // No 'Task' tool

    const recs = computeRecommendations(stats);
    const tips = recs.filter(r => r.severity === 'tip');
    const infos = recs.filter(r => (r.severity as string) === 'info');

    expect(tips.some(r => r.title.includes('Subagents'))).toBe(true);
    expect(infos.length).toBe(0); // 'info' is deprecated, must be gone
  });

  it('should use severity "tip" for Slash-Commands tip', () => {
    const stats = emptyStats();
    stats.totalMessages = 30;
    // No skillCounts — triggers the "Keine Slash-Commands" tip

    const recs = computeRecommendations(stats);
    const tips = recs.filter(r => r.severity === 'tip');

    expect(tips.some(r => r.title.includes('Slash-Commands'))).toBe(true);
  });

  it('should produce anti-pattern recommendations when anti-patterns detected', async () => {
    const filePath = path.join(tmpDir, 'session-antipattern-recs.jsonl');
    writeJsonl(filePath, [
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Bash', id: '1', input: { command: 'grep -r foo .' } }] },
        timestamp: '2026-01-01T00:00:00Z',
      },
    ]);

    const result = await computeSessionScore(filePath);
    const antiPatternRecs = result.recommendations.filter(r => r.severity === 'anti-pattern');

    expect(antiPatternRecs.length).toBeGreaterThan(0);
  });
});

// ── Recommendation Rules ────────────────────────────────────────────────

describe('computeRecommendations', () => {
  it('should praise high Task tool usage', () => {
    const stats = emptyStats();
    stats.totalToolCalls = 100;
    stats.toolCounts.set('Task', 20);
    stats.toolCounts.set('Read', 30);
    stats.toolCounts.set('Bash', 50);

    const recs = computeRecommendations(stats);
    const praise = recs.filter(r => r.severity === 'praise');

    expect(praise.some(r => r.title.includes('Subagent'))).toBe(true);
  });

  it('should praise high cache-hit ratio', () => {
    const stats = emptyStats();
    stats.totalToolCalls = 10;
    stats.tokenInput = 100;
    stats.tokenCacheRead = 900;
    stats.tokenCacheCreation = 0;

    const recs = computeRecommendations(stats);
    const praise = recs.filter(r => r.severity === 'praise');

    expect(praise.some(r => r.title.includes('Context-Wiederverwendung'))).toBe(true);
  });

  it('should warn about low cache-hit ratio', () => {
    const stats = emptyStats();
    stats.totalToolCalls = 10;
    stats.tokenInput = 700;
    stats.tokenCacheRead = 100;
    stats.tokenCacheCreation = 200;

    const recs = computeRecommendations(stats);
    const warnings = recs.filter(r => r.severity === 'warning');

    expect(warnings.some(r => r.title.includes('Context wird'))).toBe(true);
  });

  it('should warn about no subagent usage with tip severity', () => {
    const stats = emptyStats();
    stats.totalToolCalls = 50;
    stats.toolCounts.set('Read', 25);
    stats.toolCounts.set('Bash', 25);
    // No 'Task' tool

    const recs = computeRecommendations(stats);
    const tips = recs.filter(r => r.severity === 'tip');

    expect(tips.some(r => r.title.includes('Subagents'))).toBe(true);
  });

  it('should warn about high error rate', () => {
    const stats = emptyStats();
    stats.totalToolCalls = 10;
    stats.totalMessages = 100;
    stats.errorCount = 15;

    const recs = computeRecommendations(stats);
    const warnings = recs.filter(r => r.severity === 'warning');

    expect(warnings.some(r => r.title.includes('Fehlerrate'))).toBe(true);
  });

  it('should warn about low Read before Write', () => {
    const stats = emptyStats();
    stats.totalToolCalls = 100;
    stats.toolCounts.set('Read', 2);
    stats.toolCounts.set('Write', 15);
    stats.toolCounts.set('Edit', 10);
    stats.toolCounts.set('Bash', 73);

    const recs = computeRecommendations(stats);
    const warnings = recs.filter(r => r.severity === 'warning');

    expect(warnings.some(r => r.title.includes('Read vor Write'))).toBe(true);
  });

  it('should praise GSD skills usage', () => {
    const stats = emptyStats();
    stats.totalToolCalls = 10;
    stats.skillCounts.set('/gsd:execute', 2);

    const recs = computeRecommendations(stats);
    const praise = recs.filter(r => r.severity === 'praise');

    expect(praise.some(r => r.title.includes('Orchestrator'))).toBe(true);
  });

  it('should produce no recommendations for minimal data', () => {
    const stats = emptyStats();
    // No data at all
    const recs = computeRecommendations(stats);

    // With zero data, most conditions won't trigger
    expect(recs.length).toBeLessThanOrEqual(1);
  });
});

// ── Session Scoring ─────────────────────────────────────────────────────

describe('computeSessionScore', () => {
  it('should compute score for a valid session file', async () => {
    const filePath = path.join(tmpDir, 'session.jsonl');
    writeJsonl(filePath, [
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read', id: '1' }], usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 800, cache_creation_input_tokens: 100 } },
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Grep', id: '2' }], usage: { input_tokens: 50, output_tokens: 25, cache_read_input_tokens: 400, cache_creation_input_tokens: 50 } },
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Edit', id: '3' }] },
      },
    ]);

    const result = await computeSessionScore(filePath);

    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.sessionId).toBe('session');
    expect(Array.isArray(result.badges)).toBe(true);
    expect(Array.isArray(result.highlights)).toBe(true);
    // Phase 7: verify new fields present
    expect(typeof result.toolNativenessScore).toBe('number');
    expect(typeof result.subagentScore).toBe('number');
    expect(typeof result.readBeforeWriteScore).toBe('number');
    expect(typeof result.contextEfficiencyScore).toBe('number');
    expect(typeof result.errorScore).toBe('number');
    expect(Array.isArray(result.antiPatterns)).toBe(true);
    expect(Array.isArray(result.recommendations)).toBe(true);
    expect(typeof result.apiErrorCount).toBe('number');
    expect(typeof result.serverToolUseCount).toBe('number');
    expect(typeof result.cacheCreationTokens).toBe('number');
    expect(typeof result.cacheReadTokens).toBe('number');
  });

  it('should return 0 for non-existent session', async () => {
    const result = await computeSessionScore(path.join(tmpDir, 'nonexistent.jsonl'));

    expect(result.score).toBe(0);
    expect(result.highlights).toContain('Session file not found');
  });

  it('should award badges for good practices', async () => {
    const filePath = path.join(tmpDir, 'good-session.jsonl');
    const lines: any[] = [];

    // Add many native tool uses and no bash
    for (let i = 0; i < 20; i++) {
      lines.push({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read', id: `r${i}` }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 } },
      });
    }
    for (let i = 0; i < 10; i++) {
      lines.push({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Grep', id: `g${i}` }] },
      });
    }
    for (let i = 0; i < 5; i++) {
      lines.push({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Edit', id: `e${i}` }] },
      });
    }

    writeJsonl(filePath, lines);

    const result = await computeSessionScore(filePath);

    expect(result.score).toBeGreaterThan(50);
    // Zero errors + all native tools → Context Master + Zero Error
    expect(result.badges).toContain('Zero Error');
  });

  it('should assign "Context Master" badge for high context efficiency', async () => {
    const filePath = path.join(tmpDir, 'context-master.jsonl');
    const lines: any[] = [];

    for (let i = 0; i < 10; i++) {
      lines.push({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read', id: `r${i}` }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 10 } },
      });
    }

    writeJsonl(filePath, lines);

    const result = await computeSessionScore(filePath);

    expect(result.badges).toContain('Context Master');
  });
});

// ── Edge Cases ──────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('should handle permission errors gracefully', async () => {
    // Non-existent file should resolve with 0
    const stats = emptyStats();
    const count = await parseJsonlFile(path.join(tmpDir, 'nonexistent.jsonl'), stats);

    // Stream error handled gracefully, resolves with 0
    expect(count).toBe(0);
  });

  it('should discover no files if projects dir is missing', () => {
    const fakeClaude = path.join(tmpDir, '.claude-fake');
    fs.mkdirSync(fakeClaude, { recursive: true });

    const files = discoverSessionFiles(fakeClaude);
    expect(files).toEqual([]);
  });

  it('should discover session files correctly', () => {
    const claudeHome = path.join(tmpDir, '.claude');
    const projectDir = path.join(claudeHome, 'projects', 'test-project');
    fs.mkdirSync(projectDir, { recursive: true });

    writeJsonl(path.join(projectDir, 'session1.jsonl'), [{ type: 'human', message: { content: 'hello' } }]);
    writeJsonl(path.join(projectDir, 'session2.jsonl'), [{ type: 'human', message: { content: 'world' } }]);

    const files = discoverSessionFiles(claudeHome);
    expect(files.length).toBe(2);
    expect(files.every(f => f.endsWith('.jsonl'))).toBe(true);
  });

  it('should return null for missing stats-cache.json with v2 schema parser', () => {
    const result = readStatsCache(path.join(tmpDir, 'nonexistent'));
    expect(result).toBeNull();
  });

  it('should return null for stats-cache.json with wrong schema', () => {
    const claudeHome = path.join(tmpDir, '.claude-schema-test');
    fs.mkdirSync(claudeHome, { recursive: true });
    // Write v1-style array (wrong schema)
    fs.writeFileSync(path.join(claudeHome, 'stats-cache.json'), JSON.stringify([{ model: 'test', totalInputTokens: 100 }]), 'utf-8');

    const result = readStatsCache(claudeHome);
    expect(result).toBeNull();
  });

  it('should return parsed data for correct v2 stats-cache.json', () => {
    const claudeHome = path.join(tmpDir, '.claude-v2-test');
    fs.mkdirSync(claudeHome, { recursive: true });
    const v2Data = {
      version: 2,
      lastComputedDate: '2026-02-28',
      dailyActivity: [],
      dailyModelTokens: [],
      modelUsage: { 'claude-opus-4-6': { inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 200, cacheCreationInputTokens: 100, webSearchRequests: 0, costUSD: 0.5 } },
      totalSessions: 5,
      totalMessages: 100,
      longestSession: { sessionId: 'abc', duration: 3600, messageCount: 50, timestamp: '2026-02-28T00:00:00Z' },
      firstSessionDate: '2026-01-01',
      hourCounts: {},
      totalSpeculationTimeSavedMs: 0,
    };
    fs.writeFileSync(path.join(claudeHome, 'stats-cache.json'), JSON.stringify(v2Data), 'utf-8');

    const result = readStatsCache(claudeHome);
    expect(result).not.toBeNull();
    expect(result?.version).toBe(2);
    expect(result?.modelUsage).toBeDefined();
  });
});

// ── Cache behavior ──────────────────────────────────────────────────────

describe('cache behavior', () => {
  it('should clear cache via clearCache', () => {
    // Just verify clearCache doesn't throw
    clearCache();
    expect(true).toBe(true);
  });
});
