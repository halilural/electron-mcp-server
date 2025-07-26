import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { SecurityLevel, SECURITY_PROFILES, detectSecurityLevel } from './config.js';

// Input validation schemas
export const SecureCommandSchema = z.object({
  command: z.string().min(1).max(10000),
  args: z.any().optional(),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
});

export const UserPermissionSchema = z.object({
  userId: z.string(),
  permissions: z.array(
    z.enum([
      'execute_code',
      'take_screenshot',
      'read_logs',
      'window_management',
      'file_system',
      'network_access',
    ]),
  ),
  rateLimit: z
    .object({
      maxRequests: z.number().default(100),
      windowMs: z.number().default(60000), // 1 minute
    })
    .optional(),
});

export type UserPermissions = z.infer<typeof UserPermissionSchema>;

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  sanitizedInput?: any;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export class InputValidator {
  private static securityLevel: SecurityLevel = detectSecurityLevel();

  static setSecurityLevel(level: SecurityLevel) {
    this.securityLevel = level;
    logger.info(`Security level changed to: ${level}`);
  }

  static getSecurityLevel(): SecurityLevel {
    return this.securityLevel;
  }

  private static readonly DANGEROUS_KEYWORDS = [
    'Function',
    'constructor',
    '__proto__',
    'prototype',
    'process',
    'require',
    'import',
    'fs',
    'child_process',
    'exec',
    'spawn',
    'fork',
    'cluster',
    'worker_threads',
    'vm',
    'repl',
    'readline',
    'crypto',
    'http',
    'https',
    'net',
    'dgram',
    'tls',
    'url',
    'querystring',
    'path',
    'os',
    'util',
    'events',
    'stream',
    'buffer',
    'timers',
    'setImmediate',
    'clearImmediate',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'global',
    'globalThis',
  ];

  private static readonly XSS_PATTERNS = [
    /<script[^>]*>[\s\S]*?<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<iframe[^>]*>/gi,
    /<object[^>]*>/gi,
    /<embed[^>]*>/gi,
    /<link[^>]*>/gi,
    /<meta[^>]*>/gi,
  ];

  private static readonly INJECTION_PATTERNS = [
    /['"];\s*(?:drop|delete|insert|update|select|union|exec|execute)\s+/gi,
    /\$\{[^}]*\}/g, // Template literal injection
    /`[^`]*`/g, // Backtick strings
    /eval\s*\(/gi,
    /new\s+Function\s*\(/gi, // Function constructor only, not function expressions
    /window\s*\[\s*['"]Function['"]\s*\]/gi, // Dynamic function access
  ];

  static validateCommand(input: unknown): ValidationResult {
    try {
      // Parse and validate structure
      const parsed = SecureCommandSchema.parse(input);

      const result: ValidationResult = {
        isValid: true,
        errors: [],
        sanitizedInput: parsed,
        riskLevel: 'low',
      };

      // Validate command content
      let commandValidation;
      if (parsed.command === 'eval' && parsed.args) {
        // Special validation for eval commands - validate the code being executed
        commandValidation = this.validateEvalContent(String(parsed.args));
      } else {
        commandValidation = this.validateCommandContent(parsed.command);
      }
      result.errors.push(...commandValidation.errors);
      result.riskLevel = this.calculateRiskLevel(commandValidation.riskFactors);

      // Sanitize the command
      result.sanitizedInput.command = this.sanitizeCommand(parsed.command);

      result.isValid = result.errors.length === 0 && result.riskLevel !== 'critical';

      return result;
    } catch (error) {
      return {
        isValid: false,
        errors: [
          `Invalid input structure: ${error instanceof Error ? error.message : String(error)}`,
        ],
        riskLevel: 'high',
      };
    }
  }

  private static validateCommandContent(command: string): {
    errors: string[];
    riskFactors: string[];
  } {
    const errors: string[] = [];
    const riskFactors: string[] = [];

    // Check for dangerous keywords, but allow legitimate function expressions
    for (const keyword of this.DANGEROUS_KEYWORDS) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      if (regex.test(command)) {
        // Special handling for 'Function' keyword
        if (keyword === 'Function') {
          // Allow function expressions that start with ( like (function() {})()
          // Also allow function declarations like function name() {}
          // But block Function constructor calls
          const isFunctionExpression = /^\s*\(\s*function\s*\(/.test(command.trim());
          const isFunctionDeclaration = /^\s*function\s+\w+\s*\(/.test(command.trim());
          const isFunctionConstructor =
            /(?:new\s+Function\s*\(|(?:window\.|global\.)?Function\s*\()/gi.test(command);

          if (isFunctionConstructor && !isFunctionExpression && !isFunctionDeclaration) {
            errors.push(`Dangerous keyword detected: ${keyword}`);
            riskFactors.push(`dangerous_keyword_${keyword}`);
          }
          // Skip adding error for legitimate function expressions/declarations
        } else {
          errors.push(`Dangerous keyword detected: ${keyword}`);
          riskFactors.push(`dangerous_keyword_${keyword}`);
        }
      }
    }

    // Check for XSS patterns
    for (const pattern of this.XSS_PATTERNS) {
      if (pattern.test(command)) {
        errors.push(`Potential XSS pattern detected`);
        riskFactors.push('xss_pattern');
      }
    }

    // Check for injection patterns
    for (const pattern of this.INJECTION_PATTERNS) {
      if (pattern.test(command)) {
        errors.push(`Potential code injection detected`);
        riskFactors.push('injection_pattern');
      }
    }

    // Check command length
    if (command.length > 5000) {
      errors.push(`Command too long (${command.length} chars, max 5000)`);
      riskFactors.push('excessive_length');
    }

    // Check for obfuscation attempts
    const obfuscationScore = this.calculateObfuscationScore(command);
    if (obfuscationScore > 0.7) {
      errors.push(`Potential code obfuscation detected (score: ${obfuscationScore.toFixed(2)})`);
      riskFactors.push('obfuscation');
    }

    return { errors, riskFactors };
  }

  /**
   * Special validation for eval commands - validates the actual code to be executed
   */
  private static validateEvalContent(code: string): {
    errors: string[];
    riskFactors: string[];
  } {
    const errors: string[] = [];
    const riskFactors: string[] = [];
    const profile = SECURITY_PROFILES[this.securityLevel];

    // Allow simple safe operations
    const safePatterns = [
      /^document\.(title|location|URL|domain)$/,
      /^window\.(location|navigator|screen)$/,
      /^Math\.\w+$/,
      /^Date\.\w+$/,
      /^JSON\.(parse|stringify)$/,
      /^[\w.[\]'"]+$/, // Simple property access
    ];

    // Allow DOM queries based on security level
    const domQueryPatterns = profile.allowDOMQueries
      ? [
          /^document\.querySelector\([^)]+\)$/, // Simple querySelector without function calls
          /^document\.querySelectorAll\([^)]+\)$/, // Simple querySelectorAll
          /^document\.getElementById\([^)]+\)$/, // getElementById
          /^document\.getElementsByClassName\([^)]+\)$/, // getElementsByClassName
          /^document\.getElementsByTagName\([^)]+\)$/, // getElementsByTagName
          /^document\.activeElement$/, // Check active element
        ]
      : [];

    // Allow UI interactions based on security level
    const uiInteractionPatterns = profile.allowUIInteractions
      ? [
          /^window\.getComputedStyle\([^)]+\)$/, // Get computed styles
          /^[\w.]+\.(textContent|innerText|innerHTML|value|checked|selected|disabled|hidden)$/, // Property access
          /^[\w.]+\.(clientWidth|clientHeight|offsetWidth|offsetHeight|getBoundingClientRect)$/, // Size/position
          /^[\w.]+\.(focus|blur|scrollIntoView)\(\)$/, // UI methods
        ]
      : [];

    // Check if it's a safe pattern
    const isSafe =
      safePatterns.some((pattern) => pattern.test(code.trim())) ||
      domQueryPatterns.some((pattern) => pattern.test(code.trim())) ||
      uiInteractionPatterns.some((pattern) => pattern.test(code.trim()));

    if (!isSafe) {
      // Check for dangerous keywords in eval content
      for (const keyword of this.DANGEROUS_KEYWORDS) {
        const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
        if (regex.test(code)) {
          errors.push(`Dangerous keyword detected in eval: ${keyword}`);
          riskFactors.push(`eval_dangerous_keyword_${keyword}`);
        }
      }

      // Check for function calls based on security profile
      const hasFunctionCall = /\(\s*\)|\w+\s*\(/.test(code);
      if (hasFunctionCall) {
        // Extract function name
        const functionMatch = code.match(/(\w+)\s*\(/);
        const functionName = functionMatch ? functionMatch[1] : '';

        // Check if function is allowed
        const isAllowedFunction =
          profile.allowFunctionCalls.includes('*') ||
          profile.allowFunctionCalls.some(
            (allowed) => functionName.includes(allowed) || code.includes(allowed + '('),
          );

        if (!isAllowedFunction) {
          errors.push(`Function calls in eval are restricted (${functionName})`);
          riskFactors.push('eval_function_call');
        }
      }

      // Check for assignment operations based on security profile
      if (/=(?!=)/.test(code) && !profile.allowAssignments) {
        errors.push(`Assignment operations in eval are restricted`);
        riskFactors.push('eval_assignment');
      }
    }

    return { errors, riskFactors };
  }

  private static calculateObfuscationScore(code: string): number {
    let score = 0;
    const length = code.length;

    if (length === 0) return 0;

    // Check for excessive special characters
    const specialChars = (code.match(/[^a-zA-Z0-9\s]/g) || []).length;
    const specialCharRatio = specialChars / length;
    if (specialCharRatio > 0.3) score += 0.3;

    // Check for excessive parentheses/brackets
    const brackets = (code.match(/[(){}[\]]/g) || []).length;
    const bracketRatio = brackets / length;
    if (bracketRatio > 0.2) score += 0.2;

    // Check for encoded content
    if (/\\x[0-9a-fA-F]{2}/.test(code)) score += 0.2;
    if (/\\u[0-9a-fA-F]{4}/.test(code)) score += 0.2;
    if (/\\[0-7]{3}/.test(code)) score += 0.1;

    // Check for string concatenation patterns
    const concatPatterns = (code.match(/\+\s*["'`]/g) || []).length;
    if (concatPatterns > 5) score += 0.2;

    return Math.min(score, 1.0);
  }

  private static calculateRiskLevel(riskFactors: string[]): 'low' | 'medium' | 'high' | 'critical' {
    const criticalFactors = riskFactors.filter(
      (f) => f.includes('dangerous_keyword') || f.includes('injection_pattern'),
    );

    const highFactors = riskFactors.filter(
      (f) => f.includes('xss_pattern') || f.includes('obfuscation'),
    );

    if (criticalFactors.length > 0) return 'critical';
    if (highFactors.length > 0 || riskFactors.length > 3) return 'high';
    if (riskFactors.length > 1) return 'medium';
    return 'low';
  }

  private static sanitizeCommand(command: string): string {
    // Remove dangerous patterns
    let sanitized = command;

    // Remove HTML/script tags
    sanitized = sanitized.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    sanitized = sanitized.replace(/<[^>]*>/g, '');

    // Remove javascript: URLs
    sanitized = sanitized.replace(/javascript:/gi, '');

    // For code execution, don't HTML-escape quotes as it breaks JavaScript syntax
    // Just remove dangerous URL schemes and HTML tags

    return sanitized;
  }

  static validateUserPermissions(input: unknown): ValidationResult {
    try {
      const parsed = UserPermissionSchema.parse(input);
      return {
        isValid: true,
        errors: [],
        sanitizedInput: parsed,
        riskLevel: 'low',
      };
    } catch (error) {
      return {
        isValid: false,
        errors: [
          `Invalid permissions structure: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
        riskLevel: 'high',
      };
    }
  }
}

export class RateLimiter {
  private requests: Map<string, number[]> = new Map();

  checkLimit(userId: string, maxRequests: number = 100, windowMs: number = 60000): boolean {
    const now = Date.now();
    const userRequests = this.requests.get(userId) || [];

    // Remove old requests outside the time window
    const validRequests = userRequests.filter((timestamp) => now - timestamp < windowMs);

    if (validRequests.length >= maxRequests) {
      logger.warn(
        `Rate limit exceeded for user ${userId}: ${validRequests.length}/${maxRequests} requests`,
      );
      return false;
    }

    // Add current request
    validRequests.push(now);
    this.requests.set(userId, validRequests);

    return true;
  }

  getRemainingRequests(
    userId: string,
    maxRequests: number = 100,
    windowMs: number = 60000,
  ): number {
    const now = Date.now();
    const userRequests = this.requests.get(userId) || [];
    const validRequests = userRequests.filter((timestamp) => now - timestamp < windowMs);
    return Math.max(0, maxRequests - validRequests.length);
  }
}
