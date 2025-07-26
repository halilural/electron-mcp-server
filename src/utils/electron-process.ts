import { ChildProcess } from 'child_process';

// Electron process management state
export let electronProcess: ChildProcess | null = null;
export let electronLogs: string[] = [];

/**
 * Set the current Electron process reference
 */
export function setElectronProcess(process: ChildProcess | null): void {
  electronProcess = process;
}

/**
 * Get the current Electron process reference
 */
export function getElectronProcess(): ChildProcess | null {
  return electronProcess;
}

/**
 * Add a log entry to the Electron logs
 */
export function addElectronLog(log: string): void {
  electronLogs.push(log);
  // Keep only the last 1000 logs to prevent memory issues
  if (electronLogs.length > 1000) {
    electronLogs = electronLogs.slice(-1000);
  }
}

/**
 * Get all Electron logs
 */
export function getElectronLogs(): string[] {
  return electronLogs;
}

/**
 * Clear all Electron logs
 */
export function clearElectronLogs(): void {
  electronLogs = [];
}

/**
 * Reset the Electron process state
 */
export function resetElectronProcess(): void {
  electronProcess = null;
  electronLogs = [];
}
