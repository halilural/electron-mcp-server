# MCP Security Configuration

You can control the security level of the MCP Electron server through environment variables:

## Security Levels

### STRICT (Maximum Security)
- Blocks most function calls and DOM manipulation
- Only allows basic property reading
- Best for production environments with untrusted input

```bash
export MCP_SECURITY_LEVEL=strict
```

### BALANCED (Default - Recommended)
- Allows safe UI interactions and DOM queries
- Blocks dangerous operations like eval, assignments
- Good balance between security and functionality

```bash
export MCP_SECURITY_LEVEL=balanced
```

### PERMISSIVE (More Functionality)
- Allows UI interactions, DOM manipulation, and assignments
- Still blocks dangerous keywords and injection patterns
- Good for trusted environments

```bash
export MCP_SECURITY_LEVEL=permissive
```

### DEVELOPMENT (Minimal Restrictions)
- Allows most operations for development/testing
- Minimal security restrictions
- **DO NOT USE IN PRODUCTION**

```bash
export MCP_SECURITY_LEVEL=development
```

## Auto-Detection

If no `MCP_SECURITY_LEVEL` is set, the security level is automatically detected based on `NODE_ENV`:

- `production` → `strict`
- `test` → `permissive`
- `development` → `development`
- Default → `balanced`

## Usage Examples

Based on your logs, you want to interact with UI elements. Use these secure commands instead of raw eval:

### ✅ Secure Ways to Interact:

```javascript
// Instead of: document.querySelector('button').click()
command: "click_by_selector"
args: { selector: "button[title='Create New Encyclopedia']" }

// Instead of: document.querySelector('[title="Create New Encyclopedia"]').click()
command: "click_by_text"
args: { text: "Create New Encyclopedia" }

// Instead of: location.hash = '#create'
command: "navigate_to_hash"
args: { text: "create" }

// Instead of: new KeyboardEvent('keydown', {...})
command: "send_keyboard_shortcut"
args: { text: "Ctrl+N" }
```

### ❌ What Gets Blocked (and why):

```javascript
// ❌ Raw function calls in eval
document.querySelector('[title="Create New Encyclopedia"]').click()
// Reason: Function calls are restricted for security

// ❌ Assignment operations
location.hash = '#create'
// Reason: Assignment operations can be dangerous

// ❌ Constructor calls
new KeyboardEvent('keydown', {key: 'n', metaKey: true})
// Reason: Constructor calls can be used for code injection
```

## Configuration in Code

```typescript
import { SecurityManager, SecurityLevel } from './security/manager.js';

// Create with specific security level
const securityManager = new SecurityManager({}, SecurityLevel.PERMISSIVE);

// Or change at runtime
securityManager.setSecurityLevel(SecurityLevel.BALANCED);
```
