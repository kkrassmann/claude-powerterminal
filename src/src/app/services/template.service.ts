import { Injectable } from '@angular/core';
import { IPC_CHANNELS } from '../../../shared/ipc-channels';
import { getHttpBaseUrl } from '../../../shared/ws-protocol';
import { SessionTemplate } from '../../../shared/template-types';

/**
 * Service for managing session templates.
 *
 * Supports dual-mode operation:
 * - Electron mode: uses IPC to communicate with main process
 * - Remote browser mode: uses HTTP API via fetch
 *
 * Templates are persisted in templates.json in the app's userData directory.
 */
@Injectable({
  providedIn: 'root'
})
export class TemplateService {
  constructor() {}

  /**
   * List all saved session templates.
   *
   * @returns Promise resolving to array of all templates
   */
  async listTemplates(): Promise<SessionTemplate[]> {
    // Electron mode: use IPC
    if (window.electronAPI) {
      try {
        const templates = await window.electronAPI.invoke(IPC_CHANNELS.TEMPLATE_LIST);
        return templates || [];
      } catch (error) {
        console.error('Failed to list templates:', error);
        return [];
      }
    }

    // Remote browser mode: use HTTP API
    try {
      const response = await fetch(`${getHttpBaseUrl()}/api/templates`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Failed to list templates via HTTP:', error);
      return [];
    }
  }

  /**
   * Save (create or update) a session template.
   *
   * @param template - The template to save
   */
  async saveTemplate(template: SessionTemplate): Promise<void> {
    // Electron mode: use IPC
    if (window.electronAPI) {
      try {
        await window.electronAPI.invoke(IPC_CHANNELS.TEMPLATE_SAVE, template);
      } catch (error) {
        console.error('Failed to save template:', error);
        throw new Error(`Failed to save template: ${error}`);
      }
      return;
    }

    // Remote browser mode: use HTTP API
    try {
      const response = await fetch(`${getHttpBaseUrl()}/api/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(template)
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to save template via HTTP:', error);
      throw new Error(`Failed to save template: ${error}`);
    }
  }

  /**
   * Delete a session template by ID.
   *
   * @param id - Template ID to delete
   */
  async deleteTemplate(id: string): Promise<void> {
    // Electron mode: use IPC
    if (window.electronAPI) {
      try {
        await window.electronAPI.invoke(IPC_CHANNELS.TEMPLATE_DELETE, id);
      } catch (error) {
        console.error('Failed to delete template:', error);
        throw new Error(`Failed to delete template: ${error}`);
      }
      return;
    }

    // Remote browser mode: use HTTP API
    try {
      const response = await fetch(`${getHttpBaseUrl()}/api/templates?id=${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to delete template via HTTP:', error);
      throw new Error(`Failed to delete template: ${error}`);
    }
  }

  /**
   * Record a template usage: increments useCount and updates lastUsedAt.
   * Persists the updated template back to storage.
   *
   * @param template - The template being used
   */
  async useTemplate(template: SessionTemplate): Promise<void> {
    const updated: SessionTemplate = {
      ...template,
      useCount: template.useCount + 1,
      lastUsedAt: new Date().toISOString()
    };
    await this.saveTemplate(updated);
  }
}
