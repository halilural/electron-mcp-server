import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';

export interface SandboxOptions {
  timeout?: number;
  maxMemory?: number;
  allowedModules?: string[];
  blacklistedFunctions?: string[];
}

export interface SandboxResult {
  success: boolean;
  result?: any;
  error?: string;
  executionTime: number;
  memoryUsed?: number;
}

const DEFAULT_BLACKLISTED_FUNCTIONS = [
  'eval',
  'Function',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'require',
  'import',
  'process',
  'global',
  'globalThis',
  '__dirname',
  '__filename',
  'Buffer',
  'XMLHttpRequest',
  'fetch',
  'WebSocket',
];

const DEFAULT_BLACKLISTED_OBJECTS = [
  'fs',
  'child_process',
  'cluster',
  'crypto',
  'dgram',
  'dns',
  'http',
  'https',
  'net',
  'os',
  'path',
  'stream',
  'tls',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
];

export class CodeSandbox {
  private options: Required<SandboxOptions>;

  constructor(options: SandboxOptions = {}) {
    this.options = {
      timeout: options.timeout || 5000,
      maxMemory: options.maxMemory || 50 * 1024 * 1024, // 50MB
      allowedModules: options.allowedModules || [],
      blacklistedFunctions: [
        ...DEFAULT_BLACKLISTED_FUNCTIONS,
        ...(options.blacklistedFunctions || []),
      ],
    };
  }

  async executeCode(code: string): Promise<SandboxResult> {
    const startTime = Date.now();
    const sessionId = randomUUID();

    logger.info(`Starting sandboxed execution [${sessionId}]`);

    try {
      // Validate code before execution
      const validation = this.validateCode(code);
      if (!validation.isValid) {
        return {
          success: false,
          error: `Code validation failed: ${validation.errors.join(', ')}`,
          executionTime: Date.now() - startTime,
        };
      }

      // Create isolated execution environment
      const result = await this.executeInIsolation(code, sessionId);

      const executionTime = Date.now() - startTime;
      logger.info(`Sandboxed execution completed [${sessionId}] in ${executionTime}ms`);

      return {
        success: true,
        result: result,
        executionTime,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      logger.error(`Sandboxed execution failed [${sessionId}]:`, error);

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime,
      };
    }
  }

  private validateCode(code: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for blacklisted functions
    for (const func of this.options.blacklistedFunctions) {
      const regex = new RegExp(`\\b${func}\\s*\\(`, 'g');
      if (regex.test(code)) {
        errors.push(`Forbidden function: ${func}`);
      }
    }

    // Check for blacklisted objects
    for (const obj of DEFAULT_BLACKLISTED_OBJECTS) {
      const regex = new RegExp(`\\b${obj}\\b`, 'g');
      if (regex.test(code)) {
        errors.push(`Forbidden module/object: ${obj}`);
      }
    }

    // Check for dangerous patterns
    const dangerousPatterns = [
      /require\s*\(/g,
      /import\s+.*\s+from/g,
      /\.constructor/g,
      /\.__proto__/g,
      /prototype\./g,
      /process\./g,
      /global\./g,
      /this\.constructor/g,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        errors.push(`Dangerous pattern detected: ${pattern.source}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  private async executeInIsolation(code: string, sessionId: string): Promise<any> {
    // Create a secure wrapper script
    const wrapperCode = this.createSecureWrapper(code);

    // Write to temporary file
    const tempDir = join(process.cwd(), 'temp', sessionId);
    await fs.mkdir(tempDir, { recursive: true });
    const scriptPath = join(tempDir, 'script.cjs'); // Use .cjs for CommonJS

    try {
      await fs.writeFile(scriptPath, wrapperCode);

      // Execute in isolated Node.js process
      const result = await this.executeInProcess(scriptPath);

      return result;
    } finally {
      // Cleanup
      try {
        await fs.unlink(scriptPath);
        await fs.rm(tempDir, { recursive: true, force: true });

        // Also try to clean up the parent temp directory if it's empty
        try {
          const parentTempDir = join(process.cwd(), 'temp');
          await fs.rmdir(parentTempDir);
        } catch {
          // Ignore if not empty or doesn't exist
        }
      } catch (cleanupError) {
        logger.warn(`Failed to cleanup temp files for session ${sessionId}:`, cleanupError);
      }
    }
  }

  private createSecureWrapper(userCode: string): string {
    return `
"use strict";

// Create isolated context
const sandbox = {};

// Disable dangerous globals
const originalGlobal = global;
const originalProcess = process;
const originalConsole = console;

// Create safe console
const safeConsole = {
  log: (...args) => originalConsole.log('[SANDBOX]', ...args),
  error: (...args) => originalConsole.error('[SANDBOX]', ...args),
  warn: (...args) => originalConsole.warn('[SANDBOX]', ...args)
};

// Override dangerous globals
global = undefined;
process = undefined;
require = undefined;
module = undefined;
exports = undefined;
__dirname = undefined;
__filename = undefined;

try {
  // Execute user code in try-catch
  const result = (function() {
    const console = safeConsole;
    // Use eval to properly execute the user code
    return eval(${JSON.stringify(userCode)});
  })();
  
  // Send result back
  originalProcess.stdout.write(JSON.stringify({
    success: true,
    result: result
  }));
} catch (error) {
  originalProcess.stdout.write(JSON.stringify({
    success: false,
    error: error.message,
    stack: error.stack
  }));
}
`;
  }

  private executeInProcess(scriptPath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const child = spawn('node', [scriptPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: this.options.timeout,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(stdout);
            if (result.success) {
              resolve(result.result);
            } else {
              reject(new Error(result.error));
            }
          } catch (parseError) {
            reject(new Error(`Failed to parse execution result: ${parseError}`));
          }
        } else {
          reject(new Error(`Process exited with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }
}
