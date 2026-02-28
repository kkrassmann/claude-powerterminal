/**
 * Template persistence IPC handlers.
 *
 * Handles saving, loading, and deleting session templates to/from JSON file.
 * Uses synchronous file I/O for immediate persistence (durability).
 */

import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { SessionTemplate } from '../../src/shared/template-types';

/**
 * Get the path to templates.json file in userData directory.
 */
function getTemplatesFilePath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'templates.json');
}

/**
 * Load templates from disk.
 * Returns empty array if file doesn't exist or is invalid.
 */
export function loadTemplatesFromDisk(): SessionTemplate[] {
  try {
    const filePath = getTemplatesFilePath();
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const data = fs.readFileSync(filePath, 'utf-8');
    const templates = JSON.parse(data);
    return templates;
  } catch (error: any) {
    console.error('[Template Handlers] Error loading templates:', error.message);
    return [];
  }
}

/**
 * Save templates to disk (synchronous for durability).
 */
export function saveTemplatesToDisk(templates: SessionTemplate[]): void {
  try {
    const filePath = getTemplatesFilePath();
    const dirPath = path.dirname(filePath);

    // Ensure directory exists
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    const data = JSON.stringify(templates, null, 2);
    fs.writeFileSync(filePath, data, 'utf-8');
    console.log(`[Template Handlers] Saved ${templates.length} templates to disk`);
  } catch (error: any) {
    console.error('[Template Handlers] Error saving templates:', error.message);
    throw error;
  }
}

/**
 * Register all template persistence IPC handlers.
 * Call this once during app initialization in main.ts.
 */
export function registerTemplateHandlers(): void {
  console.log('[Template Handlers] Registering template IPC handlers');

  // Handler 1: TEMPLATE_LIST - List all templates
  ipcMain.handle(IPC_CHANNELS.TEMPLATE_LIST, async () => {
    try {
      const templates = loadTemplatesFromDisk();
      return templates;
    } catch (error: any) {
      console.error('[Template Handlers] Failed to list templates:', error);
      return [];
    }
  });

  // Handler 2: TEMPLATE_SAVE - Add or update a template (upsert by id)
  ipcMain.handle(IPC_CHANNELS.TEMPLATE_SAVE, async (_event, template: SessionTemplate) => {
    console.log(`[Template Handlers] Saving template ${template.id} (${template.name})`);

    try {
      const templates = loadTemplatesFromDisk();
      const existingIndex = templates.findIndex(t => t.id === template.id);

      if (existingIndex >= 0) {
        // Update existing template
        templates[existingIndex] = template;
      } else {
        // Add new template
        templates.push(template);
      }

      saveTemplatesToDisk(templates);
      return { success: true };
    } catch (error: any) {
      console.error(`[Template Handlers] Failed to save template ${template.id}:`, error);
      return { success: false, error: error.message };
    }
  });

  // Handler 3: TEMPLATE_DELETE - Delete a template by ID
  ipcMain.handle(IPC_CHANNELS.TEMPLATE_DELETE, async (_event, templateId: string) => {
    console.log(`[Template Handlers] Deleting template ${templateId}`);

    try {
      const templates = loadTemplatesFromDisk();
      const filtered = templates.filter(t => t.id !== templateId);
      saveTemplatesToDisk(filtered);
      return { success: true };
    } catch (error: any) {
      console.error(`[Template Handlers] Failed to delete template ${templateId}:`, error);
      return { success: false, error: error.message };
    }
  });

  console.log('[Template Handlers] All template IPC handlers registered successfully');
}
