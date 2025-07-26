import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger.js';

export interface ElectronAppInfo {
  port: number;
  targets: any[];
}

export interface WindowInfo {
  id: string;
  title: string;
  url: string;
  type: string;
  description: string;
  webSocketDebuggerUrl: string;
}

export interface ElectronWindowResult {
  platform: string;
  devToolsPort?: number;
  windows: WindowInfo[];
  totalTargets: number;
  electronTargets: number;
  processInfo?: any;
  message: string;
  automationReady: boolean;
}

/**
 * Scan for running Electron applications with DevTools enabled
 */
export async function scanForElectronApps(): Promise<ElectronAppInfo[]> {
  logger.debug('Scanning for running Electron applications...');

  // Extended port range to include test apps and common custom ports
  const commonPorts = [
    9222,
    9223,
    9224,
    9225, // Default ports
    9200,
    9201,
    9202,
    9203,
    9204,
    9205, // Security test range
    9300,
    9301,
    9302,
    9303,
    9304,
    9305, // Integration test range
    9400,
    9401,
    9402,
    9403,
    9404,
    9405, // Additional range
  ];
  const foundApps: ElectronAppInfo[] = [];

  for (const port of commonPorts) {
    try {
      const response = await fetch(`http://localhost:${port}/json`, {
        signal: AbortSignal.timeout(1000),
      });

      if (response.ok) {
        const targets = await response.json();
        const pageTargets = targets.filter((target: any) => target.type === 'page');

        if (pageTargets.length > 0) {
          foundApps.push({
            port,
            targets: pageTargets,
          });
          logger.debug(`Found Electron app on port ${port} with ${pageTargets.length} windows`);
        }
      }
    } catch {
      // Continue to next port
    }
  }

  return foundApps;
}

/**
 * Get detailed process information for running Electron applications
 */
export async function getElectronProcessInfo(): Promise<any> {
  const execAsync = promisify(exec);

  try {
    const { stdout } = await execAsync(
      "ps aux | grep -i electron | grep -v grep | grep -v 'Visual Studio Code'",
    );

    const electronProcesses = stdout
      .trim()
      .split('\n')
      .filter((line) => line.includes('electron'))
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        return {
          pid: parts[1],
          cpu: parts[2],
          memory: parts[3],
          command: parts.slice(10).join(' '),
        };
      });

    return { electronProcesses };
  } catch (error) {
    logger.debug('Could not get process info:', error);
    return {};
  }
}

/**
 * Find the main target from a list of targets
 */
export function findMainTarget(targets: any[]): any | null {
  return (
    targets.find((target: any) => target.type === 'page' && !target.title.includes('DevTools')) ||
    targets.find((target: any) => target.type === 'page')
  );
}

/**
 * Get window information from any running Electron app
 */
export async function getElectronWindowInfo(
  includeChildren: boolean = false,
): Promise<ElectronWindowResult> {
  try {
    const foundApps = await scanForElectronApps();

    if (foundApps.length === 0) {
      return {
        platform: process.platform,
        windows: [],
        totalTargets: 0,
        electronTargets: 0,
        message: 'No Electron applications found with remote debugging enabled',
        automationReady: false,
      };
    }

    // Use the first found app
    const app = foundApps[0];
    const windows: WindowInfo[] = app.targets.map((target: any) => ({
      id: target.id,
      title: target.title,
      url: target.url,
      type: target.type,
      description: target.description || '',
      webSocketDebuggerUrl: target.webSocketDebuggerUrl,
    }));

    // Get additional process information
    const processInfo = await getElectronProcessInfo();

    return {
      platform: process.platform,
      devToolsPort: app.port,
      windows: includeChildren
        ? windows
        : windows.filter((w: WindowInfo) => !w.title.includes('DevTools')),
      totalTargets: windows.length,
      electronTargets: windows.length,
      processInfo,
      message: `Found running Electron application with ${windows.length} windows on port ${app.port}`,
      automationReady: true,
    };
  } catch (error) {
    logger.error('Failed to scan for applications:', error);
    return {
      platform: process.platform,
      windows: [],
      totalTargets: 0,
      electronTargets: 0,
      message: `Failed to scan for Electron applications: ${
        error instanceof Error ? error.message : String(error)
      }`,
      automationReady: false,
    };
  }
}
