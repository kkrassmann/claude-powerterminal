/**
 * Angular service for the project configuration audit feature.
 *
 * All operations use the HTTP API on the Electron static server.
 * Deep audit uses Server-Sent Events (SSE) for progress updates.
 */

import { Injectable } from '@angular/core';
import type { ProjectAuditResult, DeepAuditResult, DeepAuditProgress } from '../../../shared/audit-types';
import { getHttpBaseUrl } from '../../../shared/ws-protocol';

@Injectable({ providedIn: 'root' })
export class AuditService {

  /**
   * Load the list of Claude project paths from ~/.claude/projects/.
   * Returns decoded filesystem paths for each discovered project.
   */
  async loadProjects(): Promise<string[]> {
    const resp = await fetch(
      `${getHttpBaseUrl()}/api/audit/projects`
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
    const resp = await fetch(
      `${getHttpBaseUrl()}/api/audit/run?path=${encodeURIComponent(projectPath)}`
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  /**
   * Run a deep audit (LLM-based content analysis) for the given project path.
   * Uses Server-Sent Events (SSE) for progress updates.
   *
   * @param projectPath - Absolute filesystem path to the project root
   * @param onProgress - Optional callback for progress updates
   * @returns Deep audit result with findings and fix prompts
   */
  async runDeepAudit(
    projectPath: string,
    onProgress?: (progress: DeepAuditProgress) => void,
  ): Promise<DeepAuditResult> {
    return new Promise((resolve, reject) => {
      const url = `${getHttpBaseUrl()}/api/deep-audit/run?path=${encodeURIComponent(projectPath)}`;
      const eventSource = new EventSource(url);

      eventSource.addEventListener('progress', (event: MessageEvent) => {
        try {
          const progress = JSON.parse(event.data);
          onProgress?.(progress);
        } catch { /* ignore parse errors */ }
      });

      eventSource.addEventListener('result', (event: MessageEvent) => {
        eventSource.close();
        try {
          resolve(JSON.parse(event.data));
        } catch (err) {
          reject(new Error('Failed to parse deep audit result'));
        }
      });

      eventSource.addEventListener('error', (event: any) => {
        eventSource.close();
        if (event.data) {
          try {
            const err = JSON.parse(event.data);
            reject(new Error(err.error || 'Deep audit failed'));
            return;
          } catch { /* ignore parse errors */ }
        }
        reject(new Error('Deep audit connection failed'));
      });

      eventSource.onerror = () => {
        eventSource.close();
        reject(new Error('Deep audit SSE connection lost'));
      };
    });
  }

  /**
   * Cancel a running deep audit.
   * Signals the backend to abort the current audit and kill child processes.
   */
  async cancelDeepAudit(): Promise<boolean> {
    const resp = await fetch(
      `${getHttpBaseUrl()}/api/deep-audit/cancel`,
      { method: 'POST' },
    );
    if (!resp.ok) return false;
    const result = await resp.json();
    return result.cancelled ?? false;
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
