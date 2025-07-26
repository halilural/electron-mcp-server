/* eslint-disable no-console */
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

export class Logger {
  private static instance: Logger;
  private level: LogLevel;

  constructor(level: LogLevel = LogLevel.INFO) {
    this.level = level;
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      // Check environment variable for log level
      const envLevel = process.env.MCP_LOG_LEVEL?.toUpperCase();
      let level = LogLevel.INFO;

      switch (envLevel) {
        case 'ERROR':
          level = LogLevel.ERROR;
          break;
        case 'WARN':
          level = LogLevel.WARN;
          break;
        case 'INFO':
          level = LogLevel.INFO;
          break;
        case 'DEBUG':
          level = LogLevel.DEBUG;
          break;
      }

      Logger.instance = new Logger(level);
    }
    return Logger.instance;
  }

  setLevel(level: LogLevel) {
    this.level = level;
  }

  error(message: string, ...args: any[]) {
    if (this.level >= LogLevel.ERROR) {
      console.error(`[MCP] ERROR: ${message}`, ...args);
    }
  }

  warn(message: string, ...args: any[]) {
    if (this.level >= LogLevel.WARN) {
      console.error(`[MCP] WARN: ${message}`, ...args);
    }
  }

  info(message: string, ...args: any[]) {
    if (this.level >= LogLevel.INFO) {
      console.error(`[MCP] INFO: ${message}`, ...args);
    }
  }

  debug(message: string, ...args: any[]) {
    if (this.level >= LogLevel.DEBUG) {
      console.error(`[MCP] DEBUG: ${message}`, ...args);
    }
  }

  // Helper method to check if a certain level is enabled
  isEnabled(level: LogLevel): boolean {
    return this.level >= level;
  }
}

// Export singleton instance
export const logger = Logger.getInstance();
