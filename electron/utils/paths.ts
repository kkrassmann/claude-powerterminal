import { app } from 'electron';
import * as path from 'path';

/**
 * Get the application root directory.
 * In dev: project root (3 levels up from dist/electron/utils/)
 * In packaged: the asar archive root
 */
function getAppRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar');
  }
  return path.join(__dirname, '..', '..', '..');
}

/**
 * Get the Angular build output directory.
 * Works in both development and packaged (asar) mode.
 */
export function getAngularBuildDir(): string {
  return path.join(getAppRoot(), 'src', 'dist', 'claude-powerterminal-angular', 'browser');
}
