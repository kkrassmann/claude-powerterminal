import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LogAnalysisService } from '../../services/log-analysis.service';
import type { SessionScoreDetail, AntiPatternOccurrence, Recommendation } from '../../../../../shared/analysis-types';

/**
 * Per-session drill-down panel showing score breakdown, anti-patterns, and recommendations.
 *
 * Opened by clicking the score chip in a tile header.
 * Displays as a fixed right-side panel with overlay backdrop.
 *
 * Features:
 * - Overall score with color coding
 * - 5-dimension bar chart (tool-nativeness, subagent, read-before-write, context, error)
 * - Anti-patterns list with turn references and detail text
 * - Recommendations sorted by severity (anti-pattern → warning → tip → praise → achievement)
 * - Session metadata (model, avg turn duration, compact events)
 */
@Component({
  selector: 'app-session-detail',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './session-detail.component.html',
  styleUrls: ['./session-detail.component.css'],
})
export class SessionDetailComponent implements OnInit {
  @Input() sessionId!: string;
  @Output() close = new EventEmitter<void>();

  detail: SessionScoreDetail | null = null;
  loading = true;
  error = false;

  // Sorted recommendations: anti-pattern → warning → tip → praise → achievement
  readonly severityOrder = ['anti-pattern', 'warning', 'tip', 'praise', 'achievement'];

  constructor(private analysisService: LogAnalysisService) {}

  async ngOnInit(): Promise<void> {
    try {
      this.detail = await this.analysisService.loadSessionDetail(this.sessionId);
      if (this.detail?.recommendations) {
        // Sort recommendations by severity order
        this.detail = {
          ...this.detail,
          recommendations: [...this.detail.recommendations].sort(
            (a, b) => this.severityOrder.indexOf(a.severity) - this.severityOrder.indexOf(b.severity)
          ),
        };
      }
    } catch {
      this.error = true;
    } finally {
      this.loading = false;
    }
  }

  getScoreColor(score: number): string {
    if (score > 70) return '#a6e3a1';
    if (score > 40) return '#f9e2af';
    return '#f38ba8';
  }

  getAntiPatternLabel(pattern: string): string {
    const labels: Record<string, string> = {
      'bash-for-file-ops': 'Bash statt Grep/Read',
      'correction-loop': 'Korrektur-Schleife',
      'kitchen-sink': 'Zu breite Session',
      'infinite-exploration': 'Infinite Exploration',
    };
    return labels[pattern] ?? pattern;
  }

  onClose(): void {
    this.close.emit();
  }
}
