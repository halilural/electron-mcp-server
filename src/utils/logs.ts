import { getElectronLogs } from './electron-process.js';

// Helper function to read Electron logs
export async function readElectronLogs(
  logType: string = 'all',
  lines: number = 100,
): Promise<string[]> {
  const allLogs = getElectronLogs();

  const relevantLogs = allLogs
    .filter((log) => {
      if (logType === 'all') return true;
      if (logType === 'console') return log.includes('[Console]');
      if (logType === 'main') return log.includes('[Main]');
      if (logType === 'renderer') return log.includes('[Renderer]');
      return true;
    })
    .slice(-lines);

  return relevantLogs;
}
