import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { LogAnalysisService } from '../../services/log-analysis.service';
import { AuditService } from '../../services/audit.service';
import type { SessionAnalysis, ToolUsageStat, Recommendation, ScoreTrends } from '../../../../shared/analysis-types';
import type { ProjectAuditResult } from '../../../../shared/audit-types';

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
  imports: [CommonModule],
  templateUrl: './analysis-panel.component.html',
  styleUrls: ['./analysis-panel.component.css']
})
export class AnalysisPanelComponent implements OnInit, OnDestroy, OnChanges {
  /** Working directory of the currently selected session (for project audit) */
  @Input() projectPath: string = '';

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

  /** Whether an audit is in progress */
  auditLoading = false;

  /** Error message from last audit attempt */
  auditError: string | null = null;

  /** Last audit result */
  auditResult: ProjectAuditResult | null = null;

  /** Path that was audited (to detect changes) */
  private auditedPath: string = '';

  /** Set of file paths whose findings are expanded */
  expandedFiles = new Set<string>();

  constructor(public analysisService: LogAnalysisService, private auditService: AuditService) {}

  ngOnInit(): void {
    this.subscription = this.analysisService.analysis$.subscribe(data => {
      this.analysis = data;
      this.loading = this.analysisService.loading;
    });

    // Trigger initial load for analysis and trends
    this.analysisService.loadAnalysis();
    this.analysisService.loadTrends().then(t => { this.trends = t; });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['projectPath'] && this.activeTab === 'audit') {
      // Clear old results when session changes
      this.auditResult = null;
      this.auditError = null;
      this.expandedFiles.clear();
    }
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

  // ─── Audit tab methods ──────────────────────────────────────────────────────

  /**
   * Handle tab switching between Session-Analyse and Projekt-Audit tabs.
   */
  onTabChange(tab: 'analysis' | 'audit'): void {
    this.activeTab = tab;
  }

  /**
   * Trigger a new audit run for the current session's project.
   * Uses projectPath @Input bound to the selected session's workingDirectory.
   */
  async startAudit(): Promise<void> {
    if (!this.projectPath || this.auditLoading) return;
    this.auditLoading = true;
    this.auditError = null;
    this.expandedFiles.clear();
    try {
      this.auditResult = await this.auditService.runAudit(this.projectPath);
      this.auditedPath = this.projectPath;
    } catch (err) {
      this.auditError = String(err);
    } finally {
      this.auditLoading = false;
    }
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
}
