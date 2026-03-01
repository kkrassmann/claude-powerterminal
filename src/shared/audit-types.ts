/**
 * Shared TypeScript interfaces for the project configuration audit engine.
 * Used by both the Electron main process (audit-engine.ts) and the Angular
 * renderer (audit.service.ts, analysis-panel component).
 */

export type AuditCategory = 'claude-md' | 'skill' | 'agent' | 'mcp';
export type AuditSeverity = 'praise' | 'tip' | 'warning' | 'anti-pattern';
export type AuditCheckType = 'section-exists' | 'length-check' | 'content-regex' | 'file-exists' | 'yaml-key';

export interface AuditRule {
  id: string;           // e.g., "CMD-01"
  category: AuditCategory;
  severity: AuditSeverity;
  check: AuditCheckType;
  pattern?: string;
  min?: number;
  max?: number;
  fix: string;
}

export interface AuditFinding {
  ruleId: string;
  severity: AuditSeverity;
  passed: boolean;
  detail: string;
  fix: string;
}

export interface AuditFileResult {
  filePath: string;
  fileType: AuditCategory;
  displayName: string;
  score: number;            // 0-100
  findings: AuditFinding[]; // Only failed findings
}

export interface ProjectAuditResult {
  projectPath: string;
  projectName: string;
  overallScore: number;          // 0-100 weighted average
  improvementPotential: number;  // 100 - overallScore
  files: AuditFileResult[];
  cachedAt: number;
}
