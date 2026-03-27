import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../src/shared/ipc-channels';

/**
 * Preload script for secure IPC communication.
 * Exposes a limited, type-safe API to the renderer process via contextBridge.
 *
 * Security: Only whitelisted IPC channels are allowed, preventing arbitrary IPC access.
 */

// Build whitelist from IPC_CHANNELS constants
const validChannels = new Set<string>(Object.values(IPC_CHANNELS));

function assertValidChannel(channel: string): void {
  if (!validChannels.has(channel)) {
    throw new Error(`Blocked IPC access to unauthorized channel: "${channel}"`);
  }
}

// Define the API shape for type safety
export interface ElectronAPI {
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  on: (channel: string, callback: (...args: any[]) => void) => void;
  removeListener: (channel: string, callback: (...args: any[]) => void) => void;
}

// Detect dev mode via additionalArguments from main process
const isDev = process.argv.includes('--cpt-dev-mode');

// Expose protected methods via contextBridge
contextBridge.exposeInMainWorld('electronAPI', {
  isDev,
  /**
   * Invoke an IPC handler in the main process and wait for a response.
   * @param channel - IPC channel name (use IPC_CHANNELS constants)
   * @param args - Arguments to pass to the handler
   * @returns Promise with the handler's return value
   */
  invoke: (channel: string, ...args: any[]): Promise<any> => {
    assertValidChannel(channel);
    return ipcRenderer.invoke(channel, ...args);
  },

  /**
   * Listen for events from the main process.
   * @param channel - IPC channel name (use IPC_CHANNELS constants)
   * @param callback - Function to call when event is received
   */
  on: (channel: string, callback: (...args: any[]) => void): void => {
    assertValidChannel(channel);
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },

  /**
   * Remove event listener.
   * @param channel - IPC channel name
   * @param callback - The callback function to remove
   */
  removeListener: (channel: string, callback: (...args: any[]) => void): void => {
    assertValidChannel(channel);
    ipcRenderer.removeListener(channel, callback);
  },
});

// Extend Window interface for TypeScript
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
