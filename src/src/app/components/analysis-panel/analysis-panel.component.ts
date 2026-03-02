import { Component, Input, OnInit, OnDestroy, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { LogAnalysisService } from '../../services/log-analysis.service';
import { AuditService } from '../../services/audit.service';
import { TemplateService } from '../../services/template.service';
import type { SessionAnalysis, ToolUsageStat, Recommendation, ScoreTrends } from '../../../../shared/analysis-types';
import type { ProjectAuditResult, AuditFileResult, DeepAuditResult, DeepAuditFinding, DeepAuditProgress } from '../../../../shared/audit-types';

/**
 * Collapsible analysis panel showing session log analysis results.
 *
 * Sections:
 * 1. Overview: session count, message count, tool calls, date range
 * 2. Tool Usage: horizontal CSS bars sorted by frequency
 * 3. Token Usage: cache hit ratio bar, input/output/cache totals
 * 4. Problems: detected issues with type badge and count
 * 5. Recommendations: severity-colored cards (praise/info/warning/critical)
 * 6. Practice Score: overall score with visual indicator
 */
@Component({
  selector: 'app-analysis-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './analysis-panel.component.html',
  styleUrls: ['./analysis-panel.component.css']
})
export class AnalysisPanelComponent implements OnInit, OnDestroy {
  /** Working directories of all active sessions (for project audit dropdown) */
  @Input() sessionPaths: string[] = [];

  analysis: SessionAnalysis | null = null;
  loading = false;

  /** Trend data for sparkline section */
  trends: ScoreTrends | null = null;

  /** Whether the Trends section is expanded */
  trendsExpanded = true;

  /** Track which sections are collapsed */
  collapsedSections: Record<string, boolean> = {};

  private subscription: Subscription | null = null;

  // ─── Audit tab state ────────────────────────────────────────────────────────

  /** Active tab: session analysis or project audit */
  activeTab: 'analysis' | 'audit' = 'analysis';

  /** Currently selected project path for audit */
  selectedProject: string = '';

  /** Whether the heuristic audit results accordion is expanded */
  auditResultsExpanded = true;

  /** Whether the deep audit results accordion is expanded */
  deepAuditResultsExpanded = true;

  /** Whether an audit is in progress */
  auditLoading = false;

  /** Error message from last audit attempt */
  auditError: string | null = null;

  /** Last audit result */
  auditResult: ProjectAuditResult | null = null;

  /** Set of file paths whose findings are expanded */
  expandedFiles = new Set<string>();

  /** Rule ID whose prompt was recently copied (for "Copied!" feedback) */
  copiedRuleId: string | null = null;

  // ─── Deep Audit state ───────────────────────────────────────────────────────

  /** Whether a deep audit is currently running */
  deepAuditLoading = false;

  /** Deep audit result (LLM-based content analysis) */
  deepAuditResult: DeepAuditResult | null = null;

  /** Current deep audit progress */
  deepAuditProgress: DeepAuditProgress | null = null;

  /** Error message from last deep audit attempt */
  deepAuditError: string | null = null;

  /** Set of file paths whose deep findings are expanded */
  expandedDeepFiles = new Set<string>();

  /** File path whose fix prompt was recently copied */
  copiedDeepFixFile: string | null = null;

  /** Track which individual deep findings have expanded reasoning */
  expandedDeepReasonings = new Set<string>();

  /** Whether the deep audit confirmation dialog is shown */
  showDeepAuditConfirm = false;

  /** All files that will be audited (set from first progress event with fileList). */
  deepAuditFileList: Array<{ path: string; displayName: string }> = [];

  /** File path currently being analyzed by the LLM. */
  deepAuditCurrentFile: string | null = null;

  /** Set of file paths that have completed analysis. */
  deepAuditCompletedFiles = new Set<string>();

  /** Working directories from templates (loaded once on init). */
  templatePaths: string[] = [];

  constructor(
    public analysisService: LogAnalysisService,
    private auditService: AuditService,
    private templateService: TemplateService,
    private ngZone: NgZone,
  ) {}

  ngOnInit(): void {
    this.subscription = this.analysisService.analysis$.subscribe(data => {
      this.analysis = data;
      this.loading = this.analysisService.loading;
    });

    // Trigger initial load for analysis and trends
    this.analysisService.loadAnalysis();
    this.analysisService.loadTrends().then(t => { this.trends = t; });

    // Load template paths for the project audit dropdown
    this.templateService.listTemplates().then(templates => {
      this.templatePaths = templates
        .map(t => t.workingDirectory)
        .filter(Boolean);
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  /** Reload analysis data */
  refresh(): void {
    this.analysisService.loadAnalysis();
  }

  /** Toggle section collapse */
  toggleSection(section: string): void {
    this.collapsedSections[section] = !this.collapsedSections[section];
  }

  /** Check if section is collapsed */
  isCollapsed(section: string): boolean {
    return !!this.collapsedSections[section];
  }

  /**
   * Get bar width percentage for a tool usage stat.
   * Max tool gets 100%, others are proportional.
   */
  getBarWidth(tool: ToolUsageStat, allTools: ToolUsageStat[]): number {
    if (!allTools.length) return 0;
    const max = allTools[0].count; // Already sorted by frequency
    if (max === 0) return 0;
    return (tool.count / max) * 100;
  }

  /**
   * Get Catppuccin color for tool bar based on index.
   */
  getToolColor(index: number): string {
    const colors = [
      '#89b4fa', // blue
      '#a6e3a1', // green
      '#f9e2af', // yellow
      '#cba6f7', // mauve
      '#f38ba8', // red
      '#fab387', // peach
      '#94e2d5', // teal
      '#f5c2e7', // pink
      '#74c7ec', // sapphire
      '#b4befe', // lavender
    ];
    return colors[index % colors.length];
  }

  /**
   * Get CSS class for recommendation severity.
   */
  getSeverityClass(severity: Recommendation['severity']): string {
    return `severity-${severity}`;
  }

  /**
   * Get score color based on value (green >70, yellow >40, red <=40).
   */
  getScoreColor(score: number): string {
    if (score > 70) return '#a6e3a1'; // green
    if (score > 40) return '#f9e2af'; // yellow
    return '#f38ba8'; // red
  }

  /**
   * Format large numbers with K/M suffix.
   */
  formatNumber(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toString();
  }

  /**
   * Build an SVG polyline path string for a sparkline.
   * Normalizes values to the given pixel dimensions.
   *
   * @param values - Array of numeric values
   * @param width - SVG width in pixels (default 60)
   * @param height - SVG height in pixels (default 20)
   * @returns SVG path string (M...L...L...) or empty string if fewer than 2 values
   */
  buildSparklinePath(values: number[], width = 60, height = 20): string {
    if (!values || values.length < 2) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const xStep = width / (values.length - 1);
    const points = values.map((v, i) => {
      const x = i * xStep;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M${points.join(' L')}`;
  }

  /**
   * Pre-computed sparkline dimensions for the Trends section.
   * Computed as getter to avoid per-change-detection recalculation.
   * Returns empty array when fewer than 2 history entries exist.
   */
  get sparklineDimensions(): Array<{ label: string; path: string; color: string; lastValue: number }> {
    if (!this.trends || this.trends.entries.length < 2) return [];
    return [
      { label: 'Gesamt', path: this.buildSparklinePath(this.trends.totalScore), color: '#cdd6f4', lastValue: this.trends.totalScore.at(-1) ?? 0 },
      { label: 'Tool-Nativ', path: this.buildSparklinePath(this.trends.toolNativeness), color: '#89b4fa', lastValue: this.trends.toolNativeness.at(-1) ?? 0 },
      { label: 'Subagent', path: this.buildSparklinePath(this.trends.subagent), color: '#a6e3a1', lastValue: this.trends.subagent.at(-1) ?? 0 },
      { label: 'Read/Write', path: this.buildSparklinePath(this.trends.readBeforeWrite), color: '#fab387', lastValue: this.trends.readBeforeWrite.at(-1) ?? 0 },
      { label: 'Context', path: this.buildSparklinePath(this.trends.contextEfficiency), color: '#cba6f7', lastValue: this.trends.contextEfficiency.at(-1) ?? 0 },
      { label: 'Anti-Pattern', path: this.buildSparklinePath(this.trends.antiPatternCount), color: '#f38ba8', lastValue: this.trends.antiPatternCount.at(-1) ?? 0 },
    ];
  }

  /** Merged list of project paths: active sessions + template working directories. */
  get allProjectPaths(): string[] {
    const all = [...this.sessionPaths, ...this.templatePaths];
    return [...new Set(all)];
  }

  // ─── Audit tab methods ──────────────────────────────────────────────────────

  /**
   * Handle tab switching between Session-Analyse and Projekt-Audit tabs.
   */
  onTabChange(tab: 'analysis' | 'audit'): void {
    this.activeTab = tab;
  }

  /**
   * Trigger a new audit run for the selected session project.
   */
  async startAudit(): Promise<void> {
    if (!this.selectedProject || this.auditLoading) return;
    this.auditLoading = true;
    this.auditError = null;
    this.expandedFiles.clear();
    try {
      this.auditResult = await this.auditService.runAudit(this.selectedProject);
    } catch (err) {
      this.auditError = String(err);
    } finally {
      this.auditLoading = false;
    }
  }

  /** Shorten a path for dropdown display (last 2 segments). */
  shortenPath(p: string): string {
    const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts.length >= 2 ? parts.slice(-2).join('/') : p;
  }

  /**
   * Toggle expanded state of a file row in the audit results.
   *
   * @param filePath - Absolute path of the file to toggle
   */
  toggleFile(filePath: string): void {
    if (this.expandedFiles.has(filePath)) {
      this.expandedFiles.delete(filePath);
    } else {
      this.expandedFiles.add(filePath);
    }
  }

  /** Count passed findings for a file result. */
  countPassed(file: AuditFileResult): number {
    return file.findings.filter(f => f.passed).length;
  }

  /** Count failed findings for a file result. */
  countFailed(file: AuditFileResult): number {
    return file.findings.filter(f => !f.passed).length;
  }

  /**
   * Copy a fix prompt to clipboard and show "Copied!" feedback for 2 seconds.
   */
  copyPrompt(prompt: string, ruleId: string): void {
    navigator.clipboard.writeText(prompt).then(
      () => {
        this.copiedRuleId = ruleId;
        setTimeout(() => { this.copiedRuleId = null; }, 2000);
      },
      () => {
        // Fallback for older browsers / non-secure contexts
        const textarea = document.createElement('textarea');
        textarea.value = prompt;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        this.copiedRuleId = ruleId;
        setTimeout(() => { this.copiedRuleId = null; }, 2000);
      }
    );
  }

  /**
   * Map an audit finding severity to a CSS class for color coding.
   * Matches the 5-level severity system from Phase 7.
   *
   * @param severity - Severity string from AuditFinding
   * @returns CSS class name
   */
  severityClass(severity: string): string {
    switch (severity) {
      case 'praise':       return 'severity-praise';
      case 'tip':          return 'severity-tip';
      case 'warning':      return 'severity-warning';
      case 'anti-pattern': return 'severity-anti-pattern';
      default:             return 'severity-tip';
    }
  }

  // ─── Deep Audit methods ──────────────────────────────────────────────────────

  /**
   * Start a deep audit (LLM-based content analysis) for the selected project.
   */
  /** Show confirmation dialog before starting deep audit. */
  confirmDeepAudit(): void {
    if (!this.selectedProject || this.deepAuditLoading) return;
    this.showDeepAuditConfirm = true;
  }

  /** Incrementally accumulated findings while deep audit is running. */
  streamedFindings: DeepAuditFinding[] = [];

  async startDeepAudit(): Promise<void> {
    if (!this.selectedProject || this.deepAuditLoading) return;
    this.deepAuditLoading = true;
    this.deepAuditError = null;
    this.deepAuditResult = null;
    this.deepAuditProgress = null;
    this.streamedFindings = [];
    this.deepAuditFileList = [];
    this.deepAuditCurrentFile = null;
    this.deepAuditCompletedFiles = new Set<string>();
    this.expandedDeepFiles.clear();
    this.expandedDeepReasonings.clear();

    try {
      this.deepAuditResult = await this.auditService.runDeepAudit(
        this.selectedProject,
        (progress) => {
          // IPC and SSE events fire outside Angular's zone — run inside to trigger change detection
          this.ngZone.run(() => {
            this.deepAuditProgress = { ...progress };

            // First progress event contains the full file list
            if (progress.fileList?.length) {
              this.deepAuditFileList = progress.fileList;
            }

            // Track which file is currently being analyzed
            if (progress.currentFile) {
              this.deepAuditCurrentFile = progress.currentFile;
            }

            // Mark completed file (works even for files with 0 findings)
            if (progress.completedFile) {
              this.deepAuditCompletedFiles.add(progress.completedFile);
            }

            // Accumulate findings incrementally as each file completes
            if (progress.fileFindings?.length) {
              this.streamedFindings = [...this.streamedFindings, ...progress.fileFindings];
              // Auto-expand files that have non-praise findings
              const completedPaths = new Set(progress.fileFindings.map(f => f.filePath));
              completedPaths.forEach(p => {
                if (this.getDeepFindingsForFile(p).some(f => f.severity !== 'praise')) {
                  this.expandedDeepFiles.add(p);
                }
              });
            }
          });
        },
      );
      // Mark all files as completed after audit finishes
      this.deepAuditCurrentFile = null;
      this.deepAuditFileList.forEach(f => this.deepAuditCompletedFiles.add(f.path));
    } catch (err) {
      this.deepAuditError = String(err);
    } finally {
      this.deepAuditLoading = false;
    }
  }

  /** Cancel a running deep audit. */
  async cancelDeepAudit(): Promise<void> {
    if (!this.deepAuditLoading) return;
    await this.auditService.cancelDeepAudit();
  }

  /** Toggle expanded state of a deep audit file group. */
  toggleDeepFile(filePath: string): void {
    if (this.expandedDeepFiles.has(filePath)) {
      this.expandedDeepFiles.delete(filePath);
    } else {
      this.expandedDeepFiles.add(filePath);
    }
  }

  /** Toggle expanded reasoning for a specific deep finding. */
  toggleDeepReasoning(findingKey: string): void {
    if (this.expandedDeepReasonings.has(findingKey)) {
      this.expandedDeepReasonings.delete(findingKey);
    } else {
      this.expandedDeepReasonings.add(findingKey);
    }
  }

  /** Active findings — streamed while loading, final result when done. */
  get activeFindings(): DeepAuditFinding[] {
    if (this.deepAuditResult) return this.deepAuditResult.findings;
    return this.streamedFindings;
  }

  /** Get unique file paths from deep audit (file list when available, else from findings). */
  get deepAuditFiles(): string[] {
    // During/after audit: use the upfront file list if available
    if (this.deepAuditFileList.length > 0) {
      return this.deepAuditFileList.map(f => f.path);
    }
    // Fallback: derive from findings
    const findings = this.activeFindings;
    if (!findings.length) return [];
    const seen = new Set<string>();
    return findings
      .map(f => f.filePath)
      .filter(p => { if (seen.has(p)) return false; seen.add(p); return true; });
  }

  /** Get findings for a specific file from deep audit results. */
  getDeepFindingsForFile(filePath: string): DeepAuditFinding[] {
    return this.activeFindings.filter(f => f.filePath === filePath);
  }

  /** Check if a file has a fix prompt (i.e. has non-praise findings). */
  hasFixPrompt(filePath: string): boolean {
    return !!this.deepAuditResult?.fileFixPrompts.some(fp => fp.filePath === filePath);
  }

  /** Get display name for a file path from deep audit results. */
  getDeepFileDisplayName(filePath: string): string {
    // Check file list first (available before any findings arrive)
    const fileEntry = this.deepAuditFileList.find(f => f.path === filePath);
    if (fileEntry) return fileEntry.displayName;
    const finding = this.activeFindings.find(f => f.filePath === filePath);
    return finding?.displayName || filePath;
  }

  /**
   * Copy the per-file fix prompt to clipboard.
   */
  copyDeepFixPrompt(filePath: string): void {
    const fixPrompt = this.deepAuditResult?.fileFixPrompts.find(fp => fp.filePath === filePath);
    if (!fixPrompt) return;

    navigator.clipboard.writeText(fixPrompt.prompt).then(
      () => {
        this.copiedDeepFixFile = filePath;
        setTimeout(() => { this.copiedDeepFixFile = null; }, 2000);
      },
      () => {
        // Fallback
        const textarea = document.createElement('textarea');
        textarea.value = fixPrompt.prompt;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        this.copiedDeepFixFile = filePath;
        setTimeout(() => { this.copiedDeepFixFile = null; }, 2000);
      }
    );
  }

  /** Build a unique key for a deep finding (for tracking expanded state). */
  deepFindingKey(filePath: string, index: number): string {
    return `${filePath}:${index}`;
  }

  /** Get the current state of a file in the deep audit process. */
  getDeepFileState(filePath: string): 'pending' | 'analyzing' | 'done' {
    if (this.deepAuditCompletedFiles.has(filePath)) return 'done';
    if (this.deepAuditCurrentFile === filePath) return 'analyzing';
    return 'pending';
  }
}
