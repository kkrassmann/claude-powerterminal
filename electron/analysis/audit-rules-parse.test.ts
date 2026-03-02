/**
 * Integration test for loadAuditRules() parsing of audit-prompt.md.
 *
 * Kept separate from audit-engine.test.ts because that file globally mocks
 * 'fs' via vi.mock(), which would prevent the real readFileSync call that
 * loadAuditRules() depends on. This file intentionally does NOT mock 'fs'.
 *
 * Regression guard for: the key-value regex must match **Key:** value
 * (colon inside the bold markers), not **Key**: value (colon outside).
 */

import { describe, it, expect } from 'vitest';
import { loadAuditRules } from './audit-engine';

describe('loadAuditRules — regression: key-value regex must match **Key:** format', () => {
  it('parses all rules from audit-prompt.md without skipping any', () => {
    const rules = loadAuditRules();

    // All 27 rules defined in audit-prompt.md must be parsed.
    // If the regex is wrong (e.g. **Key**: instead of **Key:**), every rule
    // is skipped with "missing Fix field" and this returns [].
    expect(rules.length).toBeGreaterThanOrEqual(25);
  });

  it('every rule has all required fields populated', () => {
    const rules = loadAuditRules();

    for (const rule of rules) {
      expect(rule.id, `${rule.id}: missing id`).toBeTruthy();
      expect(rule.category, `${rule.id}: missing category`).toBeTruthy();
      expect(rule.severity, `${rule.id}: missing severity`).toBeTruthy();
      expect(rule.check, `${rule.id}: missing check`).toBeTruthy();
      expect(rule.fix, `${rule.id}: missing fix — regex likely broken`).toBeTruthy();
    }
  });

  it('CMD-01 has correct field values', () => {
    const rules = loadAuditRules();
    const cmd01 = rules.find(r => r.id === 'CMD-01');

    expect(cmd01).toBeDefined();
    expect(cmd01!.category).toBe('claude-md');
    expect(cmd01!.severity).toBe('warning');
    expect(cmd01!.check).toBe('file-exists');
    expect(cmd01!.pattern).toBe('CLAUDE.md');
  });

  it('CMD-02 parses numeric min/max fields correctly', () => {
    const rules = loadAuditRules();
    const cmd02 = rules.find(r => r.id === 'CMD-02');

    expect(cmd02).toBeDefined();
    expect(cmd02!.check).toBe('length-check');
    expect(cmd02!.min).toBe(20);
    expect(cmd02!.max).toBe(800);
  });

  it('covers all expected categories', () => {
    const rules = loadAuditRules();
    const categories = new Set(rules.map(r => r.category));

    expect(categories.has('claude-md')).toBe(true);
    expect(categories.has('skill')).toBe(true);
    expect(categories.has('agent')).toBe(true);
    expect(categories.has('mcp')).toBe(true);
  });
});
