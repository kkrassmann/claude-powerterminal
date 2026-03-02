/**
 * Unit tests for the project configuration audit engine.
 */

import { describe, it, expect } from 'vitest';
import { evaluateRule, loadAuditRules } from './audit-engine';
import type { AuditRule } from '../../src/shared/audit-types';

// ── content-regex-absent check type ─────────────────────────────────────

describe('evaluateRule: content-regex-absent', () => {
  const rule: AuditRule = {
    id: 'TEST-01',
    category: 'mcp',
    severity: 'warning',
    check: 'content-regex-absent',
    pattern: 'Bash\\(\\*\\)',
    fix: 'Remove Bash(*) wildcard',
  };

  it('passes when the pattern is NOT found in content', () => {
    const content = '{ "permissions": ["Bash(npm test)"] }';
    expect(evaluateRule(rule, content, content.split('\n'), '/tmp')).toBe(true);
  });

  it('fails when the pattern IS found in content', () => {
    const content = '{ "permissions": ["Bash(*)"] }';
    expect(evaluateRule(rule, content, content.split('\n'), '/tmp')).toBe(false);
  });
});

// ── Rule parsing: SEC-* rules ───────────────────────────────────────────

describe('loadAuditRules: security rules', () => {
  const rules = loadAuditRules();

  it('loads at least 25 rules total (17 base + 10 SEC)', () => {
    expect(rules.length).toBeGreaterThanOrEqual(25);
  });

  it('includes SEC-01 with correct fields', () => {
    const sec01 = rules.find(r => r.id === 'SEC-01');
    expect(sec01).toBeDefined();
    expect(sec01!.category).toBe('mcp');
    expect(sec01!.severity).toBe('anti-pattern');
    expect(sec01!.check).toBe('content-regex-absent');
    expect(sec01!.pattern).toContain('Bash');
    expect(sec01!.promptSuggestion).toBeDefined();
    expect(sec01!.promptSuggestion!.length).toBeGreaterThan(10);
    expect(sec01!.reference).toBeDefined();
    expect(sec01!.reference).toContain('http');
  });

  it('all SEC-* rules have promptSuggestion and reference', () => {
    const secRules = rules.filter(r => r.id.startsWith('SEC-'));
    expect(secRules.length).toBe(10);
    for (const rule of secRules) {
      expect(rule.promptSuggestion, `${rule.id} missing promptSuggestion`).toBeDefined();
      expect(rule.reference, `${rule.id} missing reference`).toBeDefined();
    }
  });

  it('SEC-* rules all use content-regex-absent check type', () => {
    const secRules = rules.filter(r => r.id.startsWith('SEC-'));
    for (const rule of secRules) {
      expect(rule.check, `${rule.id} should use content-regex-absent`).toBe('content-regex-absent');
    }
  });
});
