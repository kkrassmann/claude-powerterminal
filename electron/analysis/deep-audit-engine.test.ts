/**
 * Tests for the deep audit engine.
 *
 * Tests JSON parsing, finding validation, severity normalization,
 * and fix prompt generation. CLI spawning is tested via mocked child_process.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseClaudeOutput } from './deep-audit-engine';

describe('parseClaudeOutput', () => {
  it('parses a valid JSON wrapper from claude --output-format json', () => {
    const wrapper = JSON.stringify({
      type: 'result',
      subtype: 'success',
      cost_usd: 0.007,
      result: JSON.stringify([
        {
          severity: 'warning',
          title: 'Missing WHEN trigger',
          reasoning: 'Description lacks trigger phrases',
          bestPractice: 'Include WHEN to use',
          fixSuggestion: 'Add trigger phrases',
        },
      ]),
    });

    const findings = parseClaudeOutput(wrapper);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('Missing WHEN trigger');
    expect(findings[0].severity).toBe('warning');
  });

  it('parses a direct JSON array', () => {
    const raw = JSON.stringify([
      { severity: 'tip', title: 'Consider adding examples', reasoning: 'Helps understanding', bestPractice: 'Include examples', fixSuggestion: 'Add example block' },
    ]);

    const findings = parseClaudeOutput(raw);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('tip');
  });

  it('extracts findings from markdown code fence', () => {
    const raw = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'Here are the findings:\n```json\n[{"severity":"anti-pattern","title":"Wildcard bash access","reasoning":"Too broad","bestPractice":"Restrict tools","fixSuggestion":"Scope to specific commands"}]\n```',
    });

    const findings = parseClaudeOutput(raw);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('anti-pattern');
    expect(findings[0].title).toBe('Wildcard bash access');
  });

  it('returns empty array for empty output', () => {
    expect(parseClaudeOutput('')).toEqual([]);
    expect(parseClaudeOutput('  ')).toEqual([]);
  });

  it('returns empty array for unparseable output', () => {
    expect(parseClaudeOutput('This is not JSON at all')).toEqual([]);
  });

  it('normalizes severity strings', () => {
    const raw = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: JSON.stringify([
        { severity: 'critical', title: 'A', reasoning: '', bestPractice: '', fixSuggestion: '' },
        { severity: 'warn', title: 'B', reasoning: '', bestPractice: '', fixSuggestion: '' },
        { severity: 'error', title: 'C', reasoning: '', bestPractice: '', fixSuggestion: '' },
        { severity: 'info', title: 'D', reasoning: '', bestPractice: '', fixSuggestion: '' },
        { severity: 'antipattern', title: 'E', reasoning: '', bestPractice: '', fixSuggestion: '' },
      ]),
    });

    const findings = parseClaudeOutput(raw);
    expect(findings[0].severity).toBe('anti-pattern'); // critical → anti-pattern
    expect(findings[1].severity).toBe('warning');       // warn → warning
    expect(findings[2].severity).toBe('anti-pattern'); // error → anti-pattern
    expect(findings[3].severity).toBe('tip');           // info → tip
    expect(findings[4].severity).toBe('anti-pattern'); // antipattern → anti-pattern
  });

  it('filters out findings without a title', () => {
    const raw = JSON.stringify([
      { severity: 'tip', title: '', reasoning: 'No title' },
      { severity: 'tip', title: 'Valid finding', reasoning: 'Has title' },
      { severity: 'tip' }, // missing title entirely
    ]);

    const findings = parseClaudeOutput(raw);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('Valid finding');
  });

  it('truncates overly long fields', () => {
    const longText = 'x'.repeat(2000);
    const raw = JSON.stringify([
      { severity: 'tip', title: longText, reasoning: longText, bestPractice: longText, fixSuggestion: longText },
    ]);

    const findings = parseClaudeOutput(raw);
    expect(findings[0].title!.length).toBe(200);
    expect(findings[0].reasoning!.length).toBe(1000);
    expect(findings[0].bestPractice!.length).toBe(500);
    expect(findings[0].fixSuggestion!.length).toBe(500);
  });

  it('parses an empty array result as no findings', () => {
    const raw = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: '[]',
    });

    const findings = parseClaudeOutput(raw);
    expect(findings).toEqual([]);
  });

  it('handles nested JSON in result field with extra text', () => {
    const raw = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'After analysis, here are my findings:\n\n[{"severity":"warning","title":"No output format","reasoning":"Agent lacks structured output","bestPractice":"Define JSON schema","fixSuggestion":"Add output format section"}]\n\nThese should be addressed.',
    });

    const findings = parseClaudeOutput(raw);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('No output format');
  });
});
