/**
 * Environment sanitization for spawning Claude CLI child processes.
 *
 * Strips Electron-specific and Node.js environment variables that can
 * interfere with Claude CLI's config file handling.
 */

/**
 * Create a clean environment for spawning Claude CLI processes.
 * Removes Electron-injected vars that can cause Claude CLI to mishandle
 * its shared config files.
 */
export function sanitizeEnvForClaude(): Record<string, string | undefined> {
  const env = { ...process.env };

  // Remove Claude Code nesting vars
  delete env.CLAUDECODE;
  delete env.CLAUDECODE_SESSION_ID;

  // Remove all Electron-specific vars (Electron injects these into child processes)
  for (const key of Object.keys(env)) {
    if (key.startsWith('ELECTRON_') || key.startsWith('ELECTRON ')) {
      delete env[key];
    }
  }

  // Remove Node.js vars that Electron may have modified
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  delete env.ELECTRON_RUN_AS_NODE;

  return env;
}
