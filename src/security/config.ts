import { SecurityConfig } from './manager';
import { logger } from '../utils/logger';

export enum SecurityLevel {
  STRICT = 'strict', // Maximum security - blocks most function calls
  BALANCED = 'balanced', // Default - allows safe UI interactions
  PERMISSIVE = 'permissive', // Minimal restrictions - allows more operations
  DEVELOPMENT = 'development', // Least restrictive - for development/testing
}

/**
 * Represents a security profile configuration for controlling access and interactions within the application.
 *
 * @property level - The security level applied to the profile.
 * @property allowUIInteractions - Indicates if UI interactions are permitted.
 * @property allowDOMQueries - Indicates if DOM queries are allowed.
 * @property allowPropertyAccess - Indicates if property access is permitted.
 * @property allowAssignments - Indicates if assignments to properties are allowed.
 * @property allowFunctionCalls - Whitelist of allowed function patterns for invocation.
 * @property riskThreshold - The risk threshold level ('low', 'medium', 'high', or 'critical') for the profile.
 */
export interface SecurityProfile {
  level: SecurityLevel;
  allowUIInteractions: boolean;
  allowDOMQueries: boolean;
  allowPropertyAccess: boolean;
  allowAssignments: boolean;
  allowFunctionCalls: string[]; // Whitelist of allowed function patterns
  riskThreshold: 'low' | 'medium' | 'high' | 'critical';
}

export const SECURITY_PROFILES: Record<SecurityLevel, SecurityProfile> = {
  [SecurityLevel.STRICT]: {
    level: SecurityLevel.STRICT,
    allowUIInteractions: false,
    allowDOMQueries: false,
    allowPropertyAccess: true,
    allowAssignments: false,
    allowFunctionCalls: [],
    riskThreshold: 'low',
  },

  [SecurityLevel.BALANCED]: {
    level: SecurityLevel.BALANCED,
    allowUIInteractions: true,
    allowDOMQueries: true,
    allowPropertyAccess: true,
    allowAssignments: false,
    allowFunctionCalls: [
      'querySelector',
      'querySelectorAll',
      'getElementById',
      'getElementsByClassName',
      'getElementsByTagName',
      'getComputedStyle',
      'getBoundingClientRect',
      'focus',
      'blur',
      'scrollIntoView',
      'dispatchEvent',
    ],
    riskThreshold: 'medium',
  },

  [SecurityLevel.PERMISSIVE]: {
    level: SecurityLevel.PERMISSIVE,
    allowUIInteractions: true,
    allowDOMQueries: true,
    allowPropertyAccess: true,
    allowAssignments: true,
    allowFunctionCalls: [
      'querySelector',
      'querySelectorAll',
      'getElementById',
      'getElementsByClassName',
      'getElementsByTagName',
      'getComputedStyle',
      'getBoundingClientRect',
      'focus',
      'blur',
      'scrollIntoView',
      'dispatchEvent',
      'click',
      'submit',
      'addEventListener',
      'removeEventListener',
    ],
    riskThreshold: 'high',
  },

  [SecurityLevel.DEVELOPMENT]: {
    level: SecurityLevel.DEVELOPMENT,
    allowUIInteractions: true,
    allowDOMQueries: true,
    allowPropertyAccess: true,
    allowAssignments: true,
    allowFunctionCalls: ['*'], // Allow all function calls
    riskThreshold: 'critical',
  },
};

export function getSecurityConfig(
  level: SecurityLevel = SecurityLevel.BALANCED,
): Partial<SecurityConfig> {
  const profile = SECURITY_PROFILES[level];

  return {
    defaultRiskThreshold: profile.riskThreshold,
    enableInputValidation: true,
    enableAuditLog: true,
    enableSandbox: level !== SecurityLevel.DEVELOPMENT,
    enableScreenshotEncryption: level !== SecurityLevel.DEVELOPMENT,
  };
}

/**
 * Get the default security level from environment variable or fallback to BALANCED
 * Environment variable: SECURITY_LEVEL
 * Valid values: strict, balanced, permissive, development
 */
export function getDefaultSecurityLevel(): SecurityLevel {
  const envSecurityLevel = process.env.SECURITY_LEVEL;

  if (envSecurityLevel) {
    const normalizedLevel = envSecurityLevel.toLowerCase();

    // Check if the provided value is a valid SecurityLevel
    if (Object.values(SecurityLevel).includes(normalizedLevel as SecurityLevel)) {
      logger.info(`Using security level from environment: ${normalizedLevel}`);
      return normalizedLevel as SecurityLevel;
    } else {
      logger.warn(
        `Invalid security level in environment variable: ${envSecurityLevel}. Valid values are: ${Object.values(SecurityLevel).join(', ')}. Falling back to BALANCED.`,
      );
    }
  }

  logger.info('Using BALANCED security level (default)');
  return SecurityLevel.BALANCED;
}
