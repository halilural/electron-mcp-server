import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { createRequire } from 'module';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

const SERVER_STARTUP_WAIT_MS = 300;
const SERVER_EXIT_TIMEOUT_MS = 5000;
const PROCESS_KILL_SIGNAL: NodeJS.Signals = 'SIGKILL';
const QUIET_LOG_LEVEL = 'ERROR';

interface CapturedProcessOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

describe('STDIO stdout regression', () => {
  it('does not emit non-protocol text to stdout during startup', async () => {
    const result = await startServerAndCaptureOutput();

    expect(result.stdout).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.signal).toBe(null);
  });
});

/**
 * Starts the MCP server via tsx, closes stdin, and captures output streams.
 * @param cwd - The working directory used to start the server process.
 * @returns Captured stdout, stderr, exit code, and signal.
 */
async function startServerAndCaptureOutput(cwd: string = process.cwd()): Promise<CapturedProcessOutput> {
  const tsxCliPath = require.resolve('tsx/cli');
  const serverEntryPath = resolve(cwd, 'src/index.ts');

  const child = spawn(process.execPath, [tsxCliPath, serverEntryPath], {
    cwd,
    env: {
      ...process.env,
      MCP_LOG_LEVEL: QUIET_LOG_LEVEL,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk: string | Buffer) => {
    stdout += chunk.toString();
  });

  child.stderr.on('data', (chunk: string | Buffer) => {
    stderr += chunk.toString();
  });

  await waitForMilliseconds(SERVER_STARTUP_WAIT_MS);

  if (child.stdin.writable) {
    child.stdin.end();
  }

  const { exitCode, signal } = await waitForProcessExit(child, SERVER_EXIT_TIMEOUT_MS);

  return {
    stdout,
    stderr,
    exitCode,
    signal,
  };
}

/**
 * Waits for a process to exit and fails if it does not close within timeout.
 * @param child - The spawned process to monitor.
 * @param timeoutMs - Maximum wait time in milliseconds.
 * @returns The process exit code and signal.
 */
function waitForProcessExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      child.kill(PROCESS_KILL_SIGNAL);
      reject(new Error(`MCP server did not exit within ${timeoutMs}ms`));
    }, timeoutMs);

    child.once('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });

    child.once('close', (exitCode, signal) => {
      clearTimeout(timeoutId);
      resolve({ exitCode, signal });
    });
  });
}

/**
 * Waits for a specific amount of time.
 * @param milliseconds - Duration to wait in milliseconds.
 */
function waitForMilliseconds(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
