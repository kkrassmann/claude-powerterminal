import { BrowserWindow } from 'electron';

let mainWindowRef: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindowRef;
}
