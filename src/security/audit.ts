import { promises as fs, mkdirSync, writeFileSync, chmodSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { logger } from '../utils/logger.js';

export interface AuditLogEntry {
  timestamp: string;
  sessionId: string;
  userId?: string;
  action: string;
  command?: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  success: boolean;
  error?: string;
  executionTime: number;
  sourceIP?: string;
  userAgent?: string;
}

export interface SecurityMetrics {
  totalRequests: number;
  blockedRequests: number;
  highRiskRequests: number;
  criticalRiskRequests: number;
  averageExecutionTime: number;
  topCommands: { command: string; count: number }[];
  errorRate: number;
}

export class SecurityLogger {
  private logDir: string;
  private encryptionKey: Buffer;

  constructor(logDir: string = 'logs/security') {
    this.logDir = logDir;
    this.encryptionKey = this.getOrCreateEncryptionKey();
    // Note: ensureLogDirectory is called in logSecurityEvent to handle async properly
  }

  async logSecurityEvent(entry: AuditLogEntry): Promise<void> {
    try {
      // Ensure directory exists before writing
      await this.ensureLogDirectory();

      const logFile = this.getLogFilePath(new Date());
      const encryptedEntry = this.encryptLogEntry(entry);
      const logLine = JSON.stringify(encryptedEntry) + '\n';

      await fs.appendFile(logFile, logLine, 'utf8');

      // Also log to console for immediate monitoring
      const logLevel = this.getLogLevel(entry.riskLevel);
      logger[logLevel](
        `Security Event [${entry.action}]: ${entry.success ? 'SUCCESS' : 'BLOCKED'}`,
        {
          sessionId: entry.sessionId,
          userId: entry.userId,
          riskLevel: entry.riskLevel,
          executionTime: entry.executionTime,
        },
      );
    } catch (error) {
      logger.error('Failed to write security log:', error);
    }
  }

  async getSecurityMetrics(since?: Date): Promise<SecurityMetrics> {
    try {
      const entries = await this.readLogEntries(since);

      const totalRequests = entries.length;
      const blockedRequests = entries.filter((e) => !e.success).length;
      const highRiskRequests = entries.filter((e) => e.riskLevel === 'high').length;
      const criticalRiskRequests = entries.filter((e) => e.riskLevel === 'critical').length;

      const totalExecutionTime = entries.reduce((sum, e) => sum + e.executionTime, 0);
      const averageExecutionTime = totalRequests > 0 ? totalExecutionTime / totalRequests : 0;

      const commandCounts = new Map<string, number>();
      entries.forEach((e) => {
        if (e.command) {
          const truncated = e.command.substring(0, 50);
          commandCounts.set(truncated, (commandCounts.get(truncated) || 0) + 1);
        }
      });

      const topCommands = Array.from(commandCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([command, count]) => ({ command, count }));

      const errorRate = totalRequests > 0 ? blockedRequests / totalRequests : 0;

      return {
        totalRequests,
        blockedRequests,
        highRiskRequests,
        criticalRiskRequests,
        averageExecutionTime,
        topCommands,
        errorRate,
      };
    } catch (error) {
      logger.error('Failed to generate security metrics:', error);
      throw error;
    }
  }

  async searchLogs(criteria: {
    userId?: string;
    action?: string;
    riskLevel?: string;
    since?: Date;
    until?: Date;
    limit?: number;
  }): Promise<AuditLogEntry[]> {
    try {
      const entries = await this.readLogEntries(criteria.since, criteria.until);

      let filtered = entries;

      if (criteria.userId) {
        filtered = filtered.filter((e) => e.userId === criteria.userId);
      }

      if (criteria.action) {
        filtered = filtered.filter((e) => e.action === criteria.action);
      }

      if (criteria.riskLevel) {
        filtered = filtered.filter((e) => e.riskLevel === criteria.riskLevel);
      }

      if (criteria.limit) {
        filtered = filtered.slice(0, criteria.limit);
      }

      return filtered;
    } catch (error) {
      logger.error('Failed to search security logs:', error);
      throw error;
    }
  }

  private async ensureLogDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
    } catch (error) {
      logger.error('Failed to create log directory:', error);
    }
  }

  private getOrCreateEncryptionKey(): Buffer {
    const keyPath = join(this.logDir, '.security-key');

    try {
      // Try to read existing key
      const keyData = readFileSync(keyPath);
      return Buffer.from(keyData);
    } catch {
      // Generate new key
      const key = randomBytes(32);
      try {
        // Ensure directory exists before writing key
        mkdirSync(this.logDir, { recursive: true });
        writeFileSync(keyPath, key);
        // Restrict permissions on the key file
        chmodSync(keyPath, 0o600);
      } catch (error) {
        logger.warn('Failed to save encryption key:', error);
      }
      return key;
    }
  }

  private encryptLogEntry(entry: AuditLogEntry): any {
    const sensitiveFields = ['command', 'error', 'sourceIP', 'userAgent'];
    const encrypted: any = { ...entry };

    for (const field of sensitiveFields) {
      if (encrypted[field]) {
        const value = String(encrypted[field]);
        encrypted[field] = this.encryptString(value);
      }
    }

    return encrypted;
  }

  private encryptString(text: string): string {
    try {
      const iv = randomBytes(16);
      const cipher = createCipheriv('aes-256-cbc', this.encryptionKey, iv);
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      return iv.toString('hex') + ':' + encrypted;
    } catch {
      // Fallback to hash if encryption fails
      return createHash('sha256').update(text).digest('hex');
    }
  }

  private decryptString(encryptedText: string): string {
    try {
      const parts = encryptedText.split(':');
      if (parts.length !== 2) return '[ENCRYPTED]';

      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];

      const decipher = createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch {
      return '[ENCRYPTED]';
    }
  }

  private getLogFilePath(date: Date): string {
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    return join(this.logDir, `security-${dateStr}.log`);
  }

  private getLogLevel(riskLevel: string): 'info' | 'warn' | 'error' {
    switch (riskLevel) {
      case 'critical':
        return 'error';
      case 'high':
        return 'error';
      case 'medium':
        return 'warn';
      default:
        return 'info';
    }
  }

  private async readLogEntries(since?: Date, until?: Date): Promise<AuditLogEntry[]> {
    const entries: AuditLogEntry[] = [];
    const now = new Date();
    const startDate = since || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    const endDate = until || now;

    // Read log files for the date range
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const logFile = this.getLogFilePath(currentDate);

      try {
        const content = await fs.readFile(logFile, 'utf8');
        const lines = content.trim().split('\n');

        for (const line of lines) {
          if (line.trim()) {
            try {
              const entry = JSON.parse(line);
              entries.push(this.decryptLogEntry(entry));
            } catch (parseError) {
              logger.warn('Failed to parse log entry:', parseError);
            }
          }
        }
      } catch {
        // File doesn't exist or can't be read - skip silently
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return entries.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }

  private decryptLogEntry(entry: any): AuditLogEntry {
    const sensitiveFields = ['command', 'error', 'sourceIP', 'userAgent'];
    const decrypted = { ...entry };

    for (const field of sensitiveFields) {
      if (decrypted[field]) {
        decrypted[field] = this.decryptString(decrypted[field]);
      }
    }

    return decrypted as AuditLogEntry;
  }
}

// Global security logger instance
export const securityLogger = new SecurityLogger();
