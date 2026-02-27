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
      { type: 'assistant', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 200, cache_creation_input_tokens: 30 } },
      { type: 'assistant', usage: { input_tokens: 150, output_tokens: 75, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 } },
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
      { type: 'assistant', usage: { input_tokens: 100 } },
      { type: 'assistant', usage: {} },
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

  it('should warn about no subagent usage', () => {
    const stats = emptyStats();
    stats.totalToolCalls = 50;
    stats.toolCounts.set('Read', 25);
    stats.toolCounts.set('Bash', 25);
    // No 'Task' tool

    const recs = computeRecommendations(stats);
    const infos = recs.filter(r => r.severity === 'info');

    expect(infos.some(r => r.title.includes('Subagents'))).toBe(true);
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
        message: { content: [{ type: 'tool_use', name: 'Read', id: '1' }] },
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 800, cache_creation_input_tokens: 100 },
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Grep', id: '2' }] },
        usage: { input_tokens: 50, output_tokens: 25, cache_read_input_tokens: 400, cache_creation_input_tokens: 50 },
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
        message: { content: [{ type: 'tool_use', name: 'Read', id: `r${i}` }] },
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 },
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
    expect(result.badges).toContain('Tool Native');
  });

  it('should assign "Context Efficient" badge for high cache-hit ratio', async () => {
    const filePath = path.join(tmpDir, 'cache-efficient.jsonl');
    const lines: any[] = [];

    for (let i = 0; i < 10; i++) {
      lines.push({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read', id: `r${i}` }] },
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 10 },
      });
    }

    writeJsonl(filePath, lines);

    const result = await computeSessionScore(filePath);

    expect(result.badges).toContain('Context Efficient');
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

  it('should return empty array for missing stats-cache.json', () => {
    const entries = readStatsCache(path.join(tmpDir, 'nonexistent'));
    expect(entries).toEqual([]);
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
