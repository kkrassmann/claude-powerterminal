/**
 * Angular service for the project configuration audit feature.
 *
 * Dual-transport operation:
 * - Electron (IPC): Uses window.electronAPI.invoke for audit API calls
 * - Remote browser (HTTP): Falls back to HTTP API endpoints on the static server
 *
 * Modeled on log-analysis.service.ts for consistency.
 */

import { Injectable } from '@angular/core';
import type { ProjectAuditResult } from '../../../shared/audit-types';

declare const window: any;

@Injectable({ providedIn: 'root' })
export class AuditService {

  /**
   * Load the list of Claude project paths from ~/.claude/projects/.
   * Returns decoded filesystem paths for each discovered project.
   */
  async loadProjects(): Promise<string[]> {
    if (window.electronAPI) {
      return window.electronAPI.invoke('audit:projects');
    }
    const resp = await fetch(
      `http://${window.location.hostname}:9801/api/audit/projects`
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  /**
   * Run a heuristic audit for the given project path.
   * Returns a scored report with per-file findings.
   *
   * @param projectPath - Absolute filesystem path to the project root
   */
  async runAudit(projectPath: string): Promise<ProjectAuditResult> {
    if (window.electronAPI) {
      return window.electronAPI.invoke('audit:run', projectPath);
    }
    const resp = await fetch(
      `http://${window.location.hostname}:9801/api/audit/run?path=${encodeURIComponent(projectPath)}`
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  /**
   * Format a project path for display in the dropdown.
   * Extracts the last two path segments: e.g., "Dev/my-project".
   *
   * @param projectPath - Full filesystem path
   * @returns Shortened display name
   */
  formatProjectName(projectPath: string): string {
    const parts = projectPath.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts.length >= 2 ? parts.slice(-2).join('/') : projectPath;
  }
}
