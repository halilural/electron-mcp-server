import { CodeSandbox, SandboxResult } from './sandbox.js';
import { InputValidator } from './validation.js';
import { securityLogger, AuditLogEntry } from './audit.js';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import { SecurityLevel, getSecurityConfig, detectSecurityLevel } from './config.js';

export interface SecurityConfig {
  enableSandbox: boolean;
  enableInputValidation: boolean;
  enableAuditLog: boolean;
  enableScreenshotEncryption: boolean;
  defaultRiskThreshold: 'low' | 'medium' | 'high' | 'critical';
  sandboxTimeout: number;
  maxExecutionTime: number;
}

export interface SecureExecutionContext {
  command: string;
  args?: any;
  sourceIP?: string;
  userAgent?: string;
  operationType: 'command' | 'screenshot' | 'logs' | 'window_info';
}

export interface SecureExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  executionTime: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  blocked: boolean;
  sessionId: string;
}

export class SecurityManager {
  private config: SecurityConfig;
  private sandbox: CodeSandbox;
  private securityLevel: SecurityLevel;

  constructor(config: Partial<SecurityConfig> = {}, securityLevel?: SecurityLevel) {
    this.securityLevel = securityLevel || detectSecurityLevel();
    const defaultConfig = getSecurityConfig(this.securityLevel);

    this.config = {
      enableSandbox: true,
      enableInputValidation: true,
      enableAuditLog: true,
      enableScreenshotEncryption: true,
      defaultRiskThreshold: 'medium',
      sandboxTimeout: 5000,
      maxExecutionTime: 30000,
      ...defaultConfig,
      ...config,
    };

    // Set the security level in the validator
    InputValidator.setSecurityLevel(this.securityLevel);

    this.sandbox = new CodeSandbox({
      timeout: this.config.sandboxTimeout,
      maxMemory: 50 * 1024 * 1024, // 50MB
    });

    logger.info('Security Manager initialized with config:', {
      ...this.config,
      securityLevel: this.securityLevel,
    });
  }

  setSecurityLevel(level: SecurityLevel) {
    this.securityLevel = level;
    InputValidator.setSecurityLevel(level);

    // Update config based on new security level
    const newConfig = getSecurityConfig(level);
    this.config = { ...this.config, ...newConfig };

    logger.info(`Security level updated to: ${level}`);
  }

  getSecurityLevel(): SecurityLevel {
    return this.securityLevel;
  }

  async executeSecurely(context: SecureExecutionContext): Promise<SecureExecutionResult> {
    const sessionId = randomUUID();
    const startTime = Date.now();

    logger.info(`Secure execution started [${sessionId}]`, {
      command: context.command.substring(0, 100),
      operationType: context.operationType,
    });

    try {
      // Step 1: Input Validation
      const validation = InputValidator.validateCommand({
        command: context.command,
        args: context.args,
      });

      if (!validation.isValid) {
        const reason = `Input validation failed: ${validation.errors.join(', ')}`;
        return this.createBlockedResult(sessionId, startTime, reason, validation.riskLevel);
      }

      // Step 2: Risk Assessment
      if (
        validation.riskLevel === 'critical' ||
        (this.config.defaultRiskThreshold === 'high' && validation.riskLevel === 'high')
      ) {
        const reason = `Risk level too high: ${validation.riskLevel}`;
        return this.createBlockedResult(sessionId, startTime, reason, validation.riskLevel);
      }

      // Step 3: Sandboxed Execution (for JavaScript code execution only, not command dispatch)
      let executionResult: SandboxResult;
      if (
        context.operationType === 'command' &&
        this.config.enableSandbox &&
        this.shouldSandboxCommand(context.command)
      ) {
        // Only sandbox if this looks like actual JavaScript code, not a command name
        executionResult = await this.sandbox.executeCode(validation.sanitizedInput.command);
      } else {
        // For command names (like 'click_by_text') and other operations, skip sandbox
        // The actual JavaScript generation and execution happens in the enhanced commands
        executionResult = {
          success: true,
          result: validation.sanitizedInput.command,
          executionTime: 0,
        };
      }

      // Step 4: Create result
      const result: SecureExecutionResult = {
        success: executionResult.success,
        result: executionResult.result,
        error: executionResult.error,
        executionTime: Date.now() - startTime,
        riskLevel: validation.riskLevel,
        blocked: false,
        sessionId,
      };

      // Step 5: Audit Logging
      if (this.config.enableAuditLog) {
        await this.logSecurityEvent(context, result);
      }

      logger.info(`Secure execution completed [${sessionId}]`, {
        success: result.success,
        executionTime: result.executionTime,
        riskLevel: result.riskLevel,
      });

      return result;
    } catch (error) {
      const result: SecureExecutionResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
        riskLevel: 'high',
        blocked: false,
        sessionId,
      };

      if (this.config.enableAuditLog) {
        await this.logSecurityEvent(context, result);
      }

      logger.error(`Secure execution failed [${sessionId}]:`, error);
      return result;
    }
  }

  updateConfig(newConfig: Partial<SecurityConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('Security configuration updated:', newConfig);
  }

  getConfig(): SecurityConfig {
    return { ...this.config };
  }

  // Private helper methods
  private createBlockedResult(
    sessionId: string,
    startTime: number,
    reason: string,
    riskLevel: 'low' | 'medium' | 'high' | 'critical',
  ): SecureExecutionResult {
    return {
      success: false,
      error: reason,
      executionTime: Date.now() - startTime,
      riskLevel,
      blocked: true,
      sessionId,
    };
  }

  private async logSecurityEvent(
    context: SecureExecutionContext,
    result: SecureExecutionResult,
  ): Promise<void> {
    const logEntry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      sessionId: result.sessionId,
      action: context.operationType,
      command: context.command,
      riskLevel: result.riskLevel,
      success: result.success,
      error: result.error,
      executionTime: result.executionTime,
      sourceIP: context.sourceIP,
      userAgent: context.userAgent,
    };

    await securityLogger.logSecurityEvent(logEntry);
  }

  /**
   * Determines if a command should be executed in a sandbox
   * @param command The command to check
   * @returns true if the command should be sandboxed
   */
  private shouldSandboxCommand(command: string): boolean {
    // Skip sandboxing for simple command names (like MCP tool names)
    if (this.isSimpleCommandName(command)) {
      return false;
    }

    // Sandbox if it looks like JavaScript code
    const jsIndicators = [
      '(', // Function calls
      'document.', // DOM access
      'window.', // Window object access
      'const ', // Variable declarations
      'let ', // Variable declarations
      'var ', // Variable declarations
      'function', // Function definitions
      '=>', // Arrow functions
      'eval(', // Direct eval calls
      'new ', // Object instantiation
      'this.', // Object method calls
      '=', // Assignments (but not comparison)
      ';', // Statement separators
      '{', // Code blocks
      'return', // Return statements
    ];

    return jsIndicators.some((indicator) => command.includes(indicator));
  }

  /**
   * Checks if a command is a simple command name (not JavaScript code)
   * @param command The command to check
   * @returns true if it's a simple command name
   */
  private isSimpleCommandName(command: string): boolean {
    // Simple command names are typically:
    // - Single words or snake_case/kebab-case
    // - No spaces except between simple arguments
    // - No JavaScript syntax

    const simpleCommandPattern = /^[a-zA-Z_][a-zA-Z0-9_-]*(\s+[a-zA-Z0-9_-]+)*$/;
    return simpleCommandPattern.test(command.trim());
  }
}

// Global security manager instance
export const securityManager = new SecurityManager();
