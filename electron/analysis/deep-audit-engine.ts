/**
 * LLM-based deep audit engine.
 *
 * Spawns `claude -p` processes to analyze project configuration files
 * against best practices. Complements the static regex-based audit engine
 * with content-quality evaluation powered by Claude Haiku.
 *
 * Key design decisions:
 * - CLI spawn (`claude -p`) instead of Agent SDK — no API key needed
 * - Parallel execution per category for speed
 * - Structured JSON output for reliable parsing
 * - Timeout protection (120s per category, 180s overall)
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { discoverAuditFiles } from './audit-engine';
import { DEEP_AUDIT_PROMPTS } from './deep-audit-prompts';
import type {
  AuditCategory,
  DeepAuditFinding,
  DeepAuditResult,
  DeepAuditProgress,
} from '../../src/shared/audit-types';

/** Track active claude child processes for cleanup on shutdown. */
const activeChildren = new Set<ChildProcess>();

/** AbortController for the currently running deep audit (null if idle). */
let currentAuditAbort: AbortController | null = null;

/**
 * Kill all active deep audit claude processes.
 * Call this on app quit / reload.
 */
export function killAllDeepAuditProcesses(): void {
  for (const child of activeChildren) {
    try { child.kill('SIGTERM'); } catch { /* already exited */ }
  }
  activeChildren.clear();
}

/**
 * Cancel the currently running deep audit.
 * Kills all spawned child processes and signals the main loop to stop.
 * Returns true if an audit was running and got cancelled, false otherwise.
 */
export function cancelDeepAudit(): boolean {
  if (!currentAuditAbort) return false;
  console.log('[DeepAudit] Cancel requested by user');
  currentAuditAbort.abort();
  killAllDeepAuditProcesses();
  return true;
}

/** Timeout per category in ms */
const CATEGORY_TIMEOUT_MS = 120_000;

/** Overall timeout in ms (10 min — sequential processing needs more time) */
const OVERALL_TIMEOUT_MS = 600_000;

/** Default model for deep audit (cost-effective) */
const DEFAULT_MODEL = 'haiku';

/**
 * Raw finding shape returned by the LLM before enrichment.
 */
interface RawFinding {
  severity?: string;
  title?: string;
  reasoning?: string;
  bestPractice?: string;
  fixSuggestion?: string;
}

/**
 * Run a single `claude -p` invocation for one file.
 *
 * @param filePath - Absolute path to the file to analyze
 * @param fileContent - Content of the file
 * @param displayName - Human-readable name for the file
 * @param categoryPrompt - Best-practice system prompt for this category
 * @param model - Claude model to use
 * @param timeoutMs - Max execution time in ms
 * @returns Parsed findings array
 */
export function analyzeFileWithClaude(
  filePath: string,
  fileContent: string,
  displayName: string,
  categoryPrompt: string,
  model: string = DEFAULT_MODEL,
  timeoutMs: number = CATEGORY_TIMEOUT_MS,
): Promise<RawFinding[]> {
  return new Promise((resolve, reject) => {
    const claudeExe = process.platform === 'win32' ? 'claude.exe' : 'claude';

    // Prompt is piped via stdin to avoid Windows command-line length limit (~8191 chars)
    const userPrompt = `Analyze this file: ${displayName}\n\nFile content:\n\`\`\`\n${fileContent}\n\`\`\``;

    const args = [
      '-p',
      '--model', model,
      '--output-format', 'json',
      '--no-session-persistence',
      '--append-system-prompt', categoryPrompt,
      '--max-turns', '2',
    ];

    // Strip CLAUDE_* env vars so spawned claude doesn't think it's inside a session
    const cleanEnv: Record<string, string> = {};
    for (const [key, val] of Object.entries(process.env)) {
      if (val !== undefined && key !== 'CLAUDECODE' && !key.startsWith('CLAUDE_CODE')) {
        cleanEnv[key] = val;
      }
    }

    console.log(`[DeepAudit] Spawning claude for ${displayName} (${(userPrompt.length / 1024).toFixed(1)} KB prompt)`);

    const child = spawn(claudeExe, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: cleanEnv,
    });

    activeChildren.add(child);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Timeout after ${timeoutMs}ms analyzing ${displayName}`));
    }, timeoutMs);

    child.on('close', (code) => {
      activeChildren.delete(child);
      clearTimeout(timer);
      console.log(`[DeepAudit] claude exited (code ${code}) for ${displayName}, stdout: ${stdout.length} bytes, stderr: ${stderr.slice(0, 200)}`);

      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`claude exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }

      try {
        // Extract key fields from the JSON wrapper for debugging
        let debugInfo = { subtype: '?', cost: '?', result_length: 0, has_result: false, num_turns: '?' };
        try {
          const wrapper = JSON.parse(stdout.trim());
          debugInfo = {
            subtype: wrapper.subtype || '?',
            cost: wrapper.total_cost_usd?.toFixed(4) || '?',
            result_length: typeof wrapper.result === 'string' ? wrapper.result.length : 0,
            has_result: 'result' in wrapper && !!wrapper.result,
            num_turns: wrapper.num_turns || '?',
          };
        } catch { /* not JSON */ }
        console.log(`[DeepAudit] ${displayName}: subtype=${debugInfo.subtype} cost=$${debugInfo.cost} has_result=${debugInfo.has_result} result_len=${debugInfo.result_length} turns=${debugInfo.num_turns} stdout=${stdout.length}B`);
        if (debugInfo.has_result && debugInfo.result_length > 0) {
          const wrapper = JSON.parse(stdout.trim());
          console.log(`[DeepAudit] ${displayName} result (first 500):`, wrapper.result.slice(0, 500));
        }
        const parsed = parseClaudeOutput(stdout);
        console.log(`[DeepAudit] ${displayName}: parsed ${parsed.length} findings [${parsed.map(f => f.severity + ':' + (f.title || '').slice(0, 40)).join(', ')}]`);
        resolve(parsed);
      } catch (err) {
        reject(new Error(`Failed to parse output for ${displayName}: ${(err as Error).message}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });

    // Pipe prompt via stdin and close
    child.stdin.write(userPrompt);
    child.stdin.end();
  });
}

/**
 * Parse the JSON output from `claude -p --output-format json`.
 *
 * The output format wraps the response in a JSON object with a `result` field.
 * We need to extract the actual findings array from the model's text response.
 */
export function parseClaudeOutput(raw: string): RawFinding[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // claude --output-format json wraps output as: {"type":"result","subtype":"success","cost_usd":...,"result":"..."}
  // The "result" field contains the model's text response which should be our JSON array
  try {
    const wrapper = JSON.parse(trimmed);
    if (wrapper && typeof wrapper.result === 'string') {
      return extractFindingsFromText(wrapper.result);
    }
    // Budget exceeded or other error — no result field present
    if (wrapper && wrapper.subtype && wrapper.subtype !== 'success' && !wrapper.result) {
      console.warn(`[DeepAudit] Claude returned subtype="${wrapper.subtype}" with no result — likely budget exceeded`);
      return [];
    }
    // If it's already an array, use it directly
    if (Array.isArray(wrapper)) {
      return validateFindings(wrapper);
    }
  } catch {
    // Not valid JSON wrapper — try to extract from raw text
  }

  return extractFindingsFromText(trimmed);
}

/**
 * Extract a JSON findings array from text that may contain markdown fences or prose.
 */
function extractFindingsFromText(text: string): RawFinding[] {
  // Try direct parse first
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return validateFindings(parsed);
  } catch {
    // Not directly parseable
  }

  // Try extracting from markdown code fence
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1]);
      if (Array.isArray(parsed)) return validateFindings(parsed);
    } catch {
      // Failed to parse fence content
    }
  }

  // Try finding a JSON array anywhere in the text
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return validateFindings(parsed);
    } catch {
      // Failed to parse extracted array
    }
  }

  return [];
}

/**
 * Validate and normalize raw findings from LLM output.
 */
function validateFindings(arr: any[]): RawFinding[] {
  return arr
    .filter(item => item && typeof item === 'object' && item.title)
    .map(item => ({
      severity: normalizeSeverity(item.severity),
      title: String(item.title || '').slice(0, 200),
      reasoning: String(item.reasoning || '').slice(0, 1000),
      bestPractice: String(item.bestPractice || '').slice(0, 500),
      fixSuggestion: String(item.fixSuggestion || '').slice(0, 500),
    }));
}

/**
 * Normalize severity strings from LLM output to our type system.
 */
function normalizeSeverity(s: unknown): 'praise' | 'tip' | 'warning' | 'anti-pattern' {
  const str = String(s || '').toLowerCase();
  if (str === 'praise' || str === 'good' || str === 'positive') return 'praise';
  if (str === 'anti-pattern' || str === 'antipattern' || str === 'critical' || str === 'error') return 'anti-pattern';
  if (str === 'warning' || str === 'warn') return 'warning';
  return 'tip';
}

/**
 * Build the per-file fix prompt for copy-paste into a project's Claude session.
 */
function buildFixPrompt(
  filePath: string,
  displayName: string,
  findings: DeepAuditFinding[],
): string {
  // Only include issues in the fix prompt, not praise
  const issues = findings.filter(f => f.severity !== 'praise');
  if (issues.length === 0) return '';

  const findingsList = issues
    .map((f, i) => `${i + 1}. [${f.severity.toUpperCase()}] ${f.title}\n   Reasoning: ${f.reasoning}`)
    .join('\n\n');

  return `In a Deep Audit the file ${displayName} (${filePath}) was scanned.

The following issues were found:

${findingsList}

Analyze the mentioned file, check each point, and provide:
1. Your assessment of each point (confirmed / not applicable / partially applicable)
2. Concrete improvement suggestions with code changes
3. If points are not applicable, a brief explanation why`;
}

/**
 * Run a full deep audit of a Claude project.
 *
 * Discovers configuration files, groups them by category, and spawns
 * parallel `claude -p` processes to analyze each file against best practices.
 *
 * @param projectPath - Absolute path to the project root
 * @param onProgress - Optional callback for progress updates
 * @param model - Claude model to use (default: haiku)
 * @returns Deep audit results with findings and fix prompts
 */
export async function runDeepAudit(
  projectPath: string,
  onProgress?: (progress: DeepAuditProgress) => void,
  model: string = DEFAULT_MODEL,
): Promise<DeepAuditResult> {
  const startTime = Date.now();
  const abort = new AbortController();
  currentAuditAbort = abort;

  const allFiles = discoverAuditFiles(projectPath);

  // Filter to files that actually exist and have content
  const existingFiles = allFiles.filter(f => {
    try {
      return fs.existsSync(f.path) && fs.statSync(f.path).size > 0;
    } catch {
      return false;
    }
  });

  if (existingFiles.length === 0) {
    return {
      projectPath,
      projectName: path.basename(projectPath),
      findings: [],
      fileFixPrompts: [],
      modelUsed: model,
      durationMs: Date.now() - startTime,
      analyzedFiles: 0,
    };
  }

  // Group files by category
  const byCategory = new Map<AuditCategory, typeof existingFiles>();
  for (const file of existingFiles) {
    const group = byCategory.get(file.fileType) || [];
    group.push(file);
    byCategory.set(file.fileType, group);
  }

  const totalFiles = existingFiles.length;
  let processedFiles = 0;
  const allFindings: DeepAuditFinding[] = [];

  // Overall timeout protection
  const overallDeadline = Date.now() + OVERALL_TIMEOUT_MS;

  // Build flat queue of files with their category prompts
  const queue: Array<{ file: typeof existingFiles[0]; category: AuditCategory; prompt: string }> = [];
  for (const [category, files] of byCategory.entries()) {
    const prompt = DEEP_AUDIT_PROMPTS[category];
    if (!prompt) continue;
    for (const file of files) {
      queue.push({ file, category, prompt });
    }
  }

  // Pre-compute file list for inclusion in every progress event
  const fileListPayload = queue.map(q => ({ path: q.file.path, displayName: q.file.displayName }));

  onProgress?.({
    phase: 'Starting deep audit...',
    current: 0,
    total: totalFiles,
    fileList: fileListPayload,
  });

  // Process files sequentially (one claude process at a time to avoid system overload)
  for (const { file, category, prompt } of queue) {
    // Check if cancelled by user
    if (abort.signal.aborted) {
      console.log('[DeepAudit] Audit cancelled, stopping file processing');
      onProgress?.({ phase: 'Deep audit cancelled', current: processedFiles, total: totalFiles });
      break;
    }

    // Check overall deadline
    if (Date.now() >= overallDeadline) {
      console.warn(`[DeepAudit] Overall timeout reached, skipping remaining files`);
      break;
    }

    onProgress?.({
      phase: `Analyzing ${file.displayName}...`,
      current: processedFiles,
      total: totalFiles,
      currentFile: file.path,
      fileList: fileListPayload,
    });

    try {
      const content = fs.readFileSync(file.path, 'utf-8');
      const remainingMs = Math.min(
        CATEGORY_TIMEOUT_MS,
        overallDeadline - Date.now(),
      );

      if (remainingMs < 5000) {
        console.warn(`[DeepAudit] Insufficient time remaining, skipping ${file.displayName}`);
        break;
      }

      const rawFindings = await analyzeFileWithClaude(
        file.path,
        content,
        file.displayName,
        prompt,
        model,
        remainingMs,
      );

      // Enrich raw findings with file metadata
      const enriched: DeepAuditFinding[] = rawFindings.map(rf => ({
        filePath: file.path,
        displayName: file.displayName,
        category,
        severity: rf.severity as DeepAuditFinding['severity'],
        title: rf.title || 'Unknown finding',
        reasoning: rf.reasoning || '',
        bestPractice: rf.bestPractice || '',
        fixSuggestion: rf.fixSuggestion || '',
      }));

      allFindings.push(...enriched);
      // Send findings for this file immediately so UI can render incrementally
      processedFiles++;
      onProgress?.({
        phase: `Analyzed ${processedFiles}/${totalFiles} files`,
        current: processedFiles,
        total: totalFiles,
        fileFindings: enriched,
        completedFile: file.path,
        fileList: fileListPayload,
      });
    } catch (err) {
      console.error(`[DeepAudit] Failed to analyze ${file.displayName}:`, (err as Error).message);
      const errorFinding: DeepAuditFinding = {
        filePath: file.path,
        displayName: file.displayName,
        category,
        severity: 'tip',
        title: 'Analysis failed',
        reasoning: `Could not analyze this file: ${(err as Error).message}`,
        bestPractice: '',
        fixSuggestion: 'Ensure claude CLI is installed and accessible in PATH',
      };
      allFindings.push(errorFinding);
      processedFiles++;
      onProgress?.({
        phase: `Analyzed ${processedFiles}/${totalFiles} files`,
        current: processedFiles,
        total: totalFiles,
        completedFile: file.path,
        fileFindings: [errorFinding],
        fileList: fileListPayload,
      });
    }
  }

  // Build per-file fix prompts (only for files with findings)
  const findingsByFile = new Map<string, DeepAuditFinding[]>();
  for (const finding of allFindings) {
    if (finding.title === 'Analysis failed') continue;
    const group = findingsByFile.get(finding.filePath) || [];
    group.push(finding);
    findingsByFile.set(finding.filePath, group);
  }

  const fileFixPrompts: DeepAuditResult['fileFixPrompts'] = [];
  for (const [filePath, findings] of findingsByFile.entries()) {
    const displayName = findings[0]?.displayName || path.basename(filePath);
    const prompt = buildFixPrompt(filePath, displayName, findings);
    // Only add fix prompt if there are actual issues (not just praise)
    if (prompt) {
      fileFixPrompts.push({
        filePath,
        displayName,
        prompt,
        findingCount: findings.filter(f => f.severity !== 'praise').length,
      });
    }
  }

  const wasCancelled = abort.signal.aborted;
  currentAuditAbort = null;

  if (!wasCancelled) {
    onProgress?.({ phase: 'Deep audit complete', current: totalFiles, total: totalFiles });
  }

  return {
    projectPath,
    projectName: path.basename(projectPath),
    findings: allFindings,
    fileFixPrompts,
    modelUsed: model,
    durationMs: Date.now() - startTime,
    analyzedFiles: processedFiles,
    cancelled: wasCancelled,
  };
}
