import { exec } from 'child_process';
import { promisify } from 'util';
import { findElectronTarget, connectForLogs } from './electron-connection.js';
import { logger } from './logger.js';

export type LogType = 'console' | 'main' | 'renderer' | 'all';

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  source: 'console' | 'system';
}

/**
 * Read logs from running Electron applications
 */
export async function readElectronLogs(
  logType: LogType = 'all',
  lines: number = 100,
  follow: boolean = false,
): Promise<string> {
  try {
    logger.info('[MCP] Looking for running Electron applications for log access...');

    try {
      const target = await findElectronTarget();

      // Connect via WebSocket to get console logs
      if (logType === 'console' || logType === 'all') {
        return await getConsoleLogsViaDevTools(target, lines, follow);
      }
    } catch {
      logger.info('[MCP] No DevTools connection found, checking system logs...');
    }

    // Fallback to system logs if DevTools not available
    return await getSystemElectronLogs(lines);
  } catch (error) {
    throw new Error(
      `Failed to read logs: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Get console logs via Chrome DevTools Protocol
 */
async function getConsoleLogsViaDevTools(
  target: any,
  lines: number,
  follow: boolean,
): Promise<string> {
  const logs: string[] = [];

  return new Promise((resolve, reject) => {
    (async () => {
      try {
        const ws = await connectForLogs(target, (log: string) => {
          logs.push(log);
          if (logs.length >= lines && !follow) {
            ws.close();
            resolve(logs.slice(-lines).join('\n'));
          }
        });

        // For non-follow mode, try to get console history first
        if (!follow) {
          // Request console API calls from Runtime
          ws.send(
            JSON.stringify({
              id: 99,
              method: 'Runtime.evaluate',
              params: {
                expression: `console.log("Reading console history for MCP test"); "History checked"`,
                includeCommandLineAPI: true,
              },
            }),
          );

          // Wait longer for logs to be captured and history to be available
          setTimeout(() => {
            ws.close();
            resolve(logs.length > 0 ? logs.slice(-lines).join('\n') : 'No console logs available');
          }, 7000); // Increased timeout to 7 seconds
        }
      } catch (error) {
        reject(error);
      }
    })();
  });
}

/**
 * Get system logs for Electron processes
 */
async function getSystemElectronLogs(lines: number = 100): Promise<string> {
  logger.info('[MCP] Reading system logs for Electron processes...');

  try {
    const execAsync = promisify(exec);

    // Get running Electron processes
    const { stdout } = await execAsync('ps aux | grep -i electron | grep -v grep');
    const electronProcesses = stdout
      .trim()
      .split('\n')
      .filter((line) => line.length > 0);

    if (electronProcesses.length === 0) {
      return 'No Electron processes found running on the system.';
    }

    let logOutput = `Found ${electronProcesses.length} Electron process(es):\n\n`;

    electronProcesses.forEach((process, index) => {
      const parts = process.trim().split(/\s+/);
      const pid = parts[1];
      const command = parts.slice(10).join(' ');
      logOutput += `Process ${index + 1}:\n`;
      logOutput += `  PID: ${pid}\n`;
      logOutput += `  Command: ${command}\n\n`;
    });

    try {
      const { stdout: logContent } = await execAsync(
        `log show --last 1h --predicate 'process == "Electron"' --style compact | tail -${lines}`,
      );
      if (logContent.trim()) {
        logOutput += 'Recent Electron logs from system:\n';
        logOutput += '==========================================\n';
        logOutput += logContent;
      } else {
        logOutput +=
          'No recent Electron logs found in system logs. Try enabling remote debugging with --remote-debugging-port=9222 for better log access.';
      }
    } catch {
      logOutput +=
        'Could not access system logs. For detailed logging, start Electron app with --remote-debugging-port=9222';
    }

    return logOutput;
  } catch (error) {
    return `Error reading system logs: ${error instanceof Error ? error.message : String(error)}`;
  }
}
