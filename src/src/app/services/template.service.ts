import { Injectable } from '@angular/core';
import { getHttpBaseUrl } from '../../../shared/ws-protocol';
import { SessionTemplate } from '../../../shared/template-types';

/**
 * Service for managing session templates via HTTP API.
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
    try {
      const response = await fetch(`${getHttpBaseUrl()}/api/templates`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('[TemplateService] Failed to list templates:', error);
      return [];
    }
  }

  /**
   * Save (create or update) a session template.
   *
   * @param template - The template to save
   */
  async saveTemplate(template: SessionTemplate): Promise<void> {
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
      console.error('[TemplateService] Failed to save template:', error);
      throw new Error(`Failed to save template: ${error}`);
    }
  }

  /**
   * Delete a session template by ID.
   *
   * @param id - Template ID to delete
   */
  async deleteTemplate(id: string): Promise<void> {
    try {
      const response = await fetch(`${getHttpBaseUrl()}/api/templates?id=${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('[TemplateService] Failed to delete template:', error);
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
