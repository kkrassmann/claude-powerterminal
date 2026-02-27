import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { LogAnalysisService } from '../../services/log-analysis.service';
import type { SessionAnalysis, ToolUsageStat, Recommendation } from '../../../../shared/analysis-types';

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
export class AnalysisPanelComponent implements OnInit, OnDestroy {
  analysis: SessionAnalysis | null = null;
  loading = false;

  /** Track which sections are collapsed */
  collapsedSections: Record<string, boolean> = {};

  private subscription: Subscription | null = null;

  constructor(public analysisService: LogAnalysisService) {}

  ngOnInit(): void {
    this.subscription = this.analysisService.analysis$.subscribe(data => {
      this.analysis = data;
      this.loading = this.analysisService.loading;
    });

    // Trigger initial load
    this.analysisService.loadAnalysis();
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
}
