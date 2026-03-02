/**
 * Shared TypeScript interfaces for the project configuration audit engine.
 * Used by both the Electron main process (audit-engine.ts) and the Angular
 * renderer (audit.service.ts, analysis-panel component).
 */

export type AuditCategory = 'claude-md' | 'skill' | 'agent' | 'mcp';
export type AuditSeverity = 'praise' | 'tip' | 'warning' | 'anti-pattern';
export type AuditCheckType = 'section-exists' | 'length-check' | 'content-regex' | 'content-regex-absent' | 'file-exists' | 'yaml-key';

export interface AuditRule {
  id: string;           // e.g., "CMD-01"
  category: AuditCategory;
  severity: AuditSeverity;
  check: AuditCheckType;
  pattern?: string;
  min?: number;
  max?: number;
  fix: string;
  promptSuggestion?: string;
  reference?: string;
}

export interface AuditFinding {
  ruleId: string;
  severity: AuditSeverity;
  passed: boolean;
  detail: string;
  fix: string;
  promptSuggestion?: string;
  reference?: string;
}

export interface AuditFileResult {
  filePath: string;
  fileType: AuditCategory;
  displayName: string;
  score: number;            // 0-100
  findings: AuditFinding[]; // All evaluated rules (passed + failed)
}

export interface ProjectAuditResult {
  projectPath: string;
  projectName: string;
  overallScore: number;          // 0-100 weighted average
  improvementPotential: number;  // 100 - overallScore
  files: AuditFileResult[];
  cachedAt: number;
}

// ─── Deep Audit types (LLM-based content analysis) ───────────────────────────

export interface DeepAuditFinding {
  filePath: string;
  displayName: string;
  category: AuditCategory;
  severity: 'praise' | 'tip' | 'warning' | 'anti-pattern';
  title: string;
  reasoning: string;
  bestPractice: string;
  fixSuggestion: string;
}

export interface DeepAuditResult {
  projectPath: string;
  projectName: string;
  findings: DeepAuditFinding[];
  fileFixPrompts: Array<{
    filePath: string;
    displayName: string;
    prompt: string;
    findingCount: number;
  }>;
  modelUsed: string;
  durationMs: number;
  analyzedFiles: number;
  /** True if the audit was cancelled by the user before completing all files. */
  cancelled?: boolean;
}

export interface DeepAuditProgress {
  phase: string;
  current: number;
  total: number;
  /** Findings for the file that just completed (incremental delivery). */
  fileFindings?: DeepAuditFinding[];
  /** Full list of files to be audited — sent once in the first progress event. */
  fileList?: Array<{ path: string; displayName: string }>;
  /** The file currently being analyzed (set during per-file progress updates). */
  currentFile?: string;
  /** The file that just completed analysis (sent with fileFindings). */
  completedFile?: string;
}
