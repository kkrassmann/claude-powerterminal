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
import type { ProjectAuditResult, DeepAuditResult, DeepAuditProgress } from '../../../shared/audit-types';

declare const window: any;

@Injectable({ providedIn: 'root' })
export class AuditService {

  /** Callback for deep audit progress updates (set by component) */
  private deepAuditProgressCallback: ((progress: DeepAuditProgress) => void) | null = null;

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
   * Run a deep audit (LLM-based content analysis) for the given project path.
   * Supports progress updates via callback.
   *
   * @param projectPath - Absolute filesystem path to the project root
   * @param onProgress - Optional callback for progress updates
   * @returns Deep audit result with findings and fix prompts
   */
  async runDeepAudit(
    projectPath: string,
    onProgress?: (progress: DeepAuditProgress) => void,
  ): Promise<DeepAuditResult> {
    if (window.electronAPI) {
      // Register progress listener
      if (onProgress) {
        this.deepAuditProgressCallback = onProgress;
        window.electronAPI.on('deep-audit:progress', this.deepAuditProgressCallback);
      }
      try {
        const result = await window.electronAPI.invoke('deep-audit:run', projectPath);
        return result;
      } finally {
        // Clean up progress listener
        if (this.deepAuditProgressCallback) {
          window.electronAPI.removeListener('deep-audit:progress', this.deepAuditProgressCallback);
          this.deepAuditProgressCallback = null;
        }
      }
    }

    // HTTP fallback: SSE for progress
    return new Promise((resolve, reject) => {
      const url = `http://${window.location.hostname}:9801/api/deep-audit/run?path=${encodeURIComponent(projectPath)}`;
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
    if (window.electronAPI) {
      return window.electronAPI.invoke('deep-audit:cancel');
    }
    const resp = await fetch(
      `http://${window.location.hostname}:9801/api/deep-audit/cancel`,
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
