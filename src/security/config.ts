import { SecurityConfig } from './manager.js';

export enum SecurityLevel {
  STRICT = 'strict', // Maximum security - blocks most function calls
  BALANCED = 'balanced', // Default - allows safe UI interactions
  PERMISSIVE = 'permissive', // Minimal restrictions - allows more operations
  DEVELOPMENT = 'development', // Least restrictive - for development/testing
}

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
 * Environment-based security level detection
 */
export function detectSecurityLevel(): SecurityLevel {
  const env = process.env.NODE_ENV?.toLowerCase();
  const mcpSecurity = process.env.MCP_SECURITY_LEVEL?.toLowerCase();

  if (mcpSecurity) {
    switch (mcpSecurity) {
      case 'strict':
        return SecurityLevel.STRICT;
      case 'balanced':
        return SecurityLevel.BALANCED;
      case 'permissive':
        return SecurityLevel.PERMISSIVE;
      case 'development':
        return SecurityLevel.DEVELOPMENT;
    }
  }

  // Default based on environment
  switch (env) {
    case 'development':
    case 'dev':
      return SecurityLevel.DEVELOPMENT;
    case 'test':
    case 'testing':
      return SecurityLevel.PERMISSIVE;
    case 'production':
    case 'prod':
      return SecurityLevel.STRICT;
    default:
      return SecurityLevel.BALANCED;
  }
}
