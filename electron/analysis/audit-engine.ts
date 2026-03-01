/**
 * Heuristic project configuration audit engine.
 *
 * Evaluates Claude project configuration files (CLAUDE.md, skills, agents, MCP configs)
 * against a machine-parseable rule checklist (audit-prompt.md) and produces a scored report.
 *
 * No LLM API calls — pure fs.readFileSync + regex heuristics.
 * Config files are small enough for synchronous reads.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AuditRule, AuditFinding, AuditFileResult, ProjectAuditResult, AuditCategory } from '../../src/shared/audit-types';

// ─── Rule loading ────────────────────────────────────────────────────────────

/**
 * Load and parse audit rules from audit-prompt.md at runtime.
 * Rules are defined in ### RULE {ID} blocks with **Key:** Value pairs.
 *
 * @returns Parsed AuditRule[]
 */
export function loadAuditRules(): AuditRule[] {
  const promptPath = path.join(__dirname, 'audit-prompt.md');
  const content = fs.readFileSync(promptPath, 'utf-8');

  // Split into blocks on RULE headers
  const ruleHeaderRe = /^### RULE ([\w]+-\d+)/gm;
  const blocks: { id: string; body: string }[] = [];

  let match: RegExpExecArray | null;
  let lastIndex = -1;
  let lastId = '';

  while ((match = ruleHeaderRe.exec(content)) !== null) {
    if (lastIndex !== -1) {
      blocks.push({ id: lastId, body: content.slice(lastIndex, match.index) });
    }
    lastId = match[1];
    lastIndex = match.index;
  }
  // Push the last block
  if (lastIndex !== -1) {
    blocks.push({ id: lastId, body: content.slice(lastIndex) });
  }

  const keyValueRe = /\*\*(\w[\w\s-]+)\*\*:\s*(.+)/g;

  const rules: AuditRule[] = [];
  for (const block of blocks) {
    const fields: Record<string, string> = {};
    let kv: RegExpExecArray | null;
    while ((kv = keyValueRe.exec(block.body)) !== null) {
      fields[kv[1].trim().toLowerCase()] = kv[2].trim();
    }
    keyValueRe.lastIndex = 0;

    if (!fields['fix']) {
      console.warn(`[AuditEngine] Skipping rule ${block.id}: missing Fix field`);
      continue;
    }

    const rule: AuditRule = {
      id: block.id,
      category: (fields['category'] as AuditCategory) ?? 'claude-md',
      severity: (fields['severity'] as AuditRule['severity']) ?? 'tip',
      check: (fields['check'] as AuditRule['check']) ?? 'content-regex',
      pattern: fields['pattern'],
      min: fields['min'] !== undefined ? parseInt(fields['min'], 10) : undefined,
      max: fields['max'] !== undefined ? parseInt(fields['max'], 10) : undefined,
      fix: fields['fix'],
    };
    rules.push(rule);
  }

  return rules;
}

// ─── Project discovery ────────────────────────────────────────────────────────

/**
 * Decode a ~/.claude/projects/ directory name back to the real filesystem path.
 *
 * Claude encodes project paths as directory names:
 * - Windows: C:\Dev\my-project → C--Dev--my-project
 * - Unix: /home/user/project → -home-user-project
 */
function decodeClaudeProjectDir(encoded: string): string | null {
  // Windows: starts with a drive letter followed by --
  const winMatch = /^([A-Z])--(.+)$/.exec(encoded);
  if (winMatch) {
    return `${winMatch[1]}:/${winMatch[2].replace(/--/g, '/')}`;
  }
  // Unix: starts with - representing the leading /
  if (encoded.startsWith('-')) {
    return '/' + encoded.slice(1).replace(/--/g, '/');
  }
  return null;
}

/**
 * Discover Claude project paths from ~/.claude/projects/.
 * Decodes directory names and filters to only existing directories.
 *
 * @returns Sorted array of real project paths
 */
export function discoverClaudeProjects(): string[] {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');

  if (!fs.existsSync(projectsDir)) {
    return [];
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch (err) {
    console.warn('[AuditEngine] Cannot read ~/.claude/projects/:', err);
    return [];
  }

  const paths: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const decoded = decodeClaudeProjectDir(entry.name);
    if (!decoded) continue;
    try {
      if (fs.existsSync(decoded) && fs.statSync(decoded).isDirectory()) {
        paths.push(decoded);
      }
    } catch {
      // Skip paths that can't be stat'd
    }
  }

  return paths.sort();
}

// ─── File discovery ───────────────────────────────────────────────────────────

interface DiscoveredFile {
  path: string;
  fileType: AuditCategory;
  displayName: string;
}

/**
 * Recursively find .md files under a directory.
 * Silently skips unreadable directories.
 */
function findMdFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findMdFiles(full));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(full);
      }
    }
  } catch {
    // Skip unreadable directories
  }
  return results;
}

/**
 * Discover all configuration files relevant for auditing within a project.
 *
 * Discovers:
 * 1. CLAUDE.md at project root (always included, even if missing)
 * 2. .md files under .claude/commands/ (skills)
 * 3. .md files under .claude/agents/ (agents)
 * 4. .claude/settings.json (MCP config)
 * 5. .mcp.json at project root (MCP config)
 *
 * @param projectPath - Absolute path to the project root
 * @returns Array of discovered files with metadata
 */
export function discoverAuditFiles(projectPath: string): DiscoveredFile[] {
  const files: DiscoveredFile[] = [];

  // 1. CLAUDE.md (always included)
  files.push({
    path: path.join(projectPath, 'CLAUDE.md'),
    fileType: 'claude-md',
    displayName: 'CLAUDE.md',
  });

  // 2. Skills: .claude/commands/*.md
  const commandsDir = path.join(projectPath, '.claude', 'commands');
  for (const filePath of findMdFiles(commandsDir)) {
    files.push({
      path: filePath,
      fileType: 'skill',
      displayName: path.relative(projectPath, filePath).replace(/\\/g, '/'),
    });
  }

  // 3. Agents: .claude/agents/*.md
  const agentsDir = path.join(projectPath, '.claude', 'agents');
  for (const filePath of findMdFiles(agentsDir)) {
    files.push({
      path: filePath,
      fileType: 'agent',
      displayName: path.relative(projectPath, filePath).replace(/\\/g, '/'),
    });
  }

  // 4. MCP: .claude/settings.json
  const claudeSettings = path.join(projectPath, '.claude', 'settings.json');
  if (fs.existsSync(claudeSettings)) {
    files.push({
      path: claudeSettings,
      fileType: 'mcp',
      displayName: '.claude/settings.json',
    });
  }

  // 5. MCP: .mcp.json
  const mcpJson = path.join(projectPath, '.mcp.json');
  if (fs.existsSync(mcpJson)) {
    files.push({
      path: mcpJson,
      fileType: 'mcp',
      displayName: '.mcp.json',
    });
  }

  return files;
}

// ─── Rule evaluation ──────────────────────────────────────────────────────────

/**
 * Evaluate a single rule against file content.
 *
 * @param rule - The rule to evaluate
 * @param content - File content (empty string if file doesn't exist)
 * @param lines - File content split into lines
 * @param projectPath - Absolute path to project root (used for file-exists checks)
 * @returns true if the rule passes
 */
export function evaluateRule(
  rule: AuditRule,
  content: string,
  lines: string[],
  projectPath: string
): boolean {
  switch (rule.check) {
    case 'section-exists':
      return new RegExp(rule.pattern!, 'im').test(content);

    case 'length-check': {
      const minOk = rule.min === undefined || lines.length >= rule.min;
      const maxOk = rule.max === undefined || lines.length <= rule.max;
      return minOk && maxOk;
    }

    case 'content-regex':
      return new RegExp(rule.pattern!, 'im').test(content);

    case 'file-exists':
      return rule.pattern ? fs.existsSync(path.join(projectPath, rule.pattern)) : false;

    case 'yaml-key':
      return rule.pattern ? new RegExp(rule.pattern).test(content) : false;

    default:
      return true;
  }
}

// ─── Audit runner ─────────────────────────────────────────────────────────────

/**
 * Run a full heuristic audit of a Claude project.
 *
 * Evaluates all discovered configuration files against the rule checklist and
 * produces a scored ProjectAuditResult with per-file findings.
 *
 * Scoring:
 * - Per file: (passed rules / applicable rules) * 100 — 100 if no rules apply
 * - Overall: weighted average by category (claude-md=40%, skill=30%, agent=20%, mcp=10%)
 *   Missing categories are redistributed proportionally.
 *
 * @param projectPath - Absolute path to the project root to audit
 * @returns ProjectAuditResult with scores and findings
 */
export function runProjectAudit(projectPath: string): ProjectAuditResult {
  const rules = loadAuditRules();
  const discoveredFiles = discoverAuditFiles(projectPath);

  const fileResults: AuditFileResult[] = [];

  for (const file of discoveredFiles) {
    const content = fs.existsSync(file.path)
      ? fs.readFileSync(file.path, 'utf-8')
      : '';
    const lines = content ? content.split('\n') : [''];

    // Filter rules applicable to this file type
    const applicable = rules.filter(r => r.category === file.fileType);

    let passedCount = 0;
    const failedFindings: AuditFinding[] = [];

    for (const rule of applicable) {
      const passed = evaluateRule(rule, content, lines, projectPath);
      if (passed) {
        passedCount++;
      } else {
        failedFindings.push({
          ruleId: rule.id,
          severity: rule.severity,
          passed: false,
          detail: `Rule ${rule.id} failed`,
          fix: rule.fix,
        });
      }
    }

    const score = applicable.length > 0
      ? Math.round((passedCount / applicable.length) * 100)
      : 100;

    fileResults.push({
      filePath: file.path,
      fileType: file.fileType,
      displayName: file.displayName,
      score,
      findings: failedFindings,
    });
  }

  // Compute weighted overall score
  const categoryWeights: Record<AuditCategory, number> = {
    'claude-md': 0.40,
    'skill': 0.30,
    'agent': 0.20,
    'mcp': 0.10,
  };

  // Group file results by category and average within each category
  const categoryScores: Partial<Record<AuditCategory, number>> = {};
  const categories: AuditCategory[] = ['claude-md', 'skill', 'agent', 'mcp'];

  for (const cat of categories) {
    const catFiles = fileResults.filter(f => f.fileType === cat);
    if (catFiles.length === 0) continue;
    const avg = catFiles.reduce((sum, f) => sum + f.score, 0) / catFiles.length;
    categoryScores[cat] = avg;
  }

  // Redistribute weights for missing categories
  const presentCategories = categories.filter(c => categoryScores[c] !== undefined);
  const totalWeight = presentCategories.reduce((sum, c) => sum + categoryWeights[c], 0);

  let overallScore = 100;
  if (presentCategories.length > 0 && totalWeight > 0) {
    overallScore = Math.round(
      presentCategories.reduce((sum, c) => {
        return sum + (categoryScores[c]! * (categoryWeights[c] / totalWeight));
      }, 0)
    );
  }

  const projectName = path.basename(projectPath);

  return {
    projectPath,
    projectName,
    overallScore,
    improvementPotential: 100 - overallScore,
    files: fileResults,
    cachedAt: Date.now(),
  };
}
