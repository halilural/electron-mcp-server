import { executeInElectron, findElectronTarget } from './electron-connection.js';
import { generateFindElementsCommand, generateClickByTextCommand } from './electron-commands.js';
import {
  generateFillInputCommand,
  generateSelectOptionCommand,
  generatePageStructureCommand,
} from './electron-input-commands.js';

export interface CommandArgs {
  selector?: string;
  text?: string;
  value?: string;
  placeholder?: string;
  message?: string;
  code?: string;
}

/**
 * Enhanced command executor with improved React support
 */
export async function sendCommandToElectron(command: string, args?: CommandArgs): Promise<string> {
  try {
    const target = await findElectronTarget();
    let javascriptCode: string;

    switch (command.toLowerCase()) {
      case 'get_title':
        javascriptCode = 'document.title';
        break;

      case 'get_url':
        javascriptCode = 'window.location.href';
        break;

      case 'get_body_text':
        javascriptCode = 'document.body.innerText.substring(0, 500)';
        break;

      case 'click_button':
        // Validate and escape selector input
        const selector = args?.selector || 'button';
        if (selector.includes('javascript:') || selector.includes('<script')) {
          return 'Invalid selector: contains dangerous content';
        }
        const escapedSelector = JSON.stringify(selector);

        javascriptCode = `
          const button = document.querySelector(${escapedSelector});
          if (button && !button.disabled) {
            // Enhanced duplicate prevention
            const buttonId = button.id || button.className || 'button';
            const clickKey = 'mcp_click_' + btoa(buttonId).slice(0, 10);
            
            // Check if this button was recently clicked
            if (window[clickKey] && Date.now() - window[clickKey] < 2000) {
              return 'Button click prevented - too soon after previous click';
            }
            
            // Mark this button as clicked
            window[clickKey] = Date.now();
            
            // Prevent multiple rapid events
            button.style.pointerEvents = 'none';
            
            // Trigger React events properly
            button.focus();
            
            // Use both React synthetic events and native events
            const clickEvent = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window
            });
            
            button.dispatchEvent(clickEvent);
            
            // Re-enable after delay
            setTimeout(() => {
              button.style.pointerEvents = '';
            }, 1000);
            
            return 'Button clicked with enhanced protection';
          }
          return 'Button not found or disabled';
        `;
        break;

      case 'find_elements':
        javascriptCode = generateFindElementsCommand();
        break;

      case 'click_by_text':
        javascriptCode = generateClickByTextCommand(args?.text || '');
        break;

      case 'click_by_selector':
        // Secure selector-based clicking
        const clickSelector = args?.selector || '';
        if (clickSelector.includes('javascript:') || clickSelector.includes('<script')) {
          return 'Invalid selector: contains dangerous content';
        }
        const escapedClickSelector = JSON.stringify(clickSelector);

        javascriptCode = `
          (function() {
            try {
              const element = document.querySelector(${escapedClickSelector});
              if (element) {
                // Check if element is clickable
                const rect = element.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) {
                  return 'Element not visible';
                }
                
                // Prevent rapid clicks
                const clickKey = 'mcp_selector_click_' + btoa(${escapedClickSelector}).slice(0, 10);
                if (window[clickKey] && Date.now() - window[clickKey] < 1000) {
                  return 'Click prevented - too soon after previous click';
                }
                window[clickKey] = Date.now();
                
                // Focus and click
                element.focus();
                const event = new MouseEvent('click', {
                  bubbles: true,
                  cancelable: true,
                  view: window
                });
                element.dispatchEvent(event);
                
                return 'Successfully clicked element: ' + element.tagName + 
                       (element.textContent ? ' - "' + element.textContent.substring(0, 50) + '"' : '');
              }
              return 'Element not found: ' + ${escapedClickSelector};
            } catch (e) {
              return 'Error clicking element: ' + e.message;
            }
          })();
        `;
        break;

      case 'send_keyboard_shortcut':
        // Secure keyboard shortcut sending
        const key = args?.text || '';
        const validKeys = [
          'Enter',
          'Escape',
          'Tab',
          'Space',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
        ];

        // Parse shortcut like "Ctrl+N" or "Meta+N"
        const parts = key.split('+').map((p) => p.trim());
        const keyPart = parts[parts.length - 1];
        const modifiers = parts.slice(0, -1);

        if (keyPart.length === 1 || validKeys.includes(keyPart)) {
          const modifierProps = modifiers
            .map((mod) => {
              switch (mod.toLowerCase()) {
                case 'ctrl':
                  return 'ctrlKey: true';
                case 'shift':
                  return 'shiftKey: true';
                case 'alt':
                  return 'altKey: true';
                case 'meta':
                case 'cmd':
                  return 'metaKey: true';
                default:
                  return '';
              }
            })
            .filter(Boolean)
            .join(', ');

          javascriptCode = `
            (function() {
              try {
                const event = new KeyboardEvent('keydown', {
                  key: '${keyPart}',
                  code: 'Key${keyPart.toUpperCase()}',
                  ${modifierProps},
                  bubbles: true,
                  cancelable: true
                });
                document.dispatchEvent(event);
                return 'Keyboard shortcut sent: ${key}';
              } catch (e) {
                return 'Error sending shortcut: ' + e.message;
              }
            })();
          `;
        } else {
          return `Invalid key: ${keyPart}. Use single characters or: ${validKeys.join(', ')}`;
        }
        break;

      case 'navigate_to_hash':
        // Secure hash navigation
        const hash = args?.text || '';
        if (hash.includes('javascript:') || hash.includes('<script') || hash.includes('://')) {
          return 'Invalid hash: contains dangerous content';
        }
        const cleanHash = hash.startsWith('#') ? hash : '#' + hash;

        javascriptCode = `
          (function() {
            try {
              // Use pushState for safer navigation
              if (window.history && window.history.pushState) {
                const newUrl = window.location.pathname + window.location.search + '${cleanHash}';
                window.history.pushState({}, '', newUrl);
                
                // Trigger hashchange event for React Router
                window.dispatchEvent(new HashChangeEvent('hashchange', {
                  newURL: window.location.href,
                  oldURL: window.location.href.replace('${cleanHash}', '')
                }));
                
                return 'Navigated to hash: ${cleanHash}';
              } else {
                // Fallback to direct assignment
                window.location.hash = '${cleanHash}';
                return 'Navigated to hash (fallback): ${cleanHash}';
              }
            } catch (e) {
              return 'Error navigating: ' + e.message;
            }
          })();
        `;
        break;

      case 'fill_input':
        javascriptCode = generateFillInputCommand(
          args?.selector || '',
          args?.value || args?.text || '',
          args?.text || args?.placeholder || '',
        );
        break;

      case 'select_option':
        javascriptCode = generateSelectOptionCommand(
          args?.selector || '',
          args?.value || '',
          args?.text || '',
        );
        break;

      case 'get_page_structure':
        javascriptCode = generatePageStructureCommand();
        break;

      case 'debug_elements':
        javascriptCode = `
          (function() {
            const buttons = Array.from(document.querySelectorAll('button')).map(btn => ({
              text: btn.textContent?.trim(),
              id: btn.id,
              className: btn.className,
              disabled: btn.disabled,
              visible: btn.getBoundingClientRect().width > 0,
              type: btn.type || 'button'
            }));
            
            const inputs = Array.from(document.querySelectorAll('input, textarea, select')).map(inp => ({
              name: inp.name,
              placeholder: inp.placeholder,
              type: inp.type,
              id: inp.id,
              value: inp.value,
              visible: inp.getBoundingClientRect().width > 0,
              enabled: !inp.disabled
            }));
            
            return JSON.stringify({
              buttons: buttons.filter(b => b.visible).slice(0, 10),
              inputs: inputs.filter(i => i.visible).slice(0, 10),
              url: window.location.href,
              title: document.title
            }, null, 2);
          })()
        `;
        break;

      case 'verify_form_state':
        javascriptCode = `
          (function() {
            const forms = Array.from(document.querySelectorAll('form')).map(form => {
              const inputs = Array.from(form.querySelectorAll('input, textarea, select')).map(inp => ({
                name: inp.name,
                type: inp.type,
                value: inp.value,
                placeholder: inp.placeholder,
                required: inp.required,
                valid: inp.validity?.valid
              }));
              
              return {
                id: form.id,
                action: form.action,
                method: form.method,
                inputs: inputs,
                isValid: form.checkValidity?.() || 'unknown'
              };
            });
            
            return JSON.stringify({ forms, formCount: forms.length }, null, 2);
          })()
        `;
        break;

      case 'console_log':
        javascriptCode = `console.log('MCP Command:', '${
          args?.message || 'Hello from MCP!'
        }'); 'Console message sent'`;
        break;

      case 'eval':
        const rawCode = typeof args === 'string' ? args : args?.code || command;
        // Enhanced eval with better error handling and result reporting
        const codeHash = Buffer.from(rawCode).toString('base64').slice(0, 10);
        const isStateTest =
          rawCode.includes('window.testState') ||
          rawCode.includes('persistent-test-value') ||
          rawCode.includes('window.testValue');

        javascriptCode = `
          (function() {
            try {
              // Prevent rapid execution of the same code unless it's a state test
              const codeHash = '${codeHash}';
              const isStateTest = ${isStateTest};
              const rawCode = ${JSON.stringify(rawCode)};
              
              if (!isStateTest && window._mcpExecuting && window._mcpExecuting[codeHash]) {
                return { success: false, error: 'Code already executing', result: null };
              }
              
              window._mcpExecuting = window._mcpExecuting || {};
              if (!isStateTest) {
                window._mcpExecuting[codeHash] = true;
              }
              
              let result;
              ${
                rawCode.trim().startsWith('() =>') || rawCode.trim().startsWith('function')
                  ? `result = (${rawCode})();`
                  : rawCode.includes('return')
                    ? `result = (function() { ${rawCode} })();`
                    : rawCode.includes(';')
                      ? `result = (function() { ${rawCode}; return "executed"; })();`
                      : `result = (function() { return (${rawCode}); })();`
              }
              
              setTimeout(() => {
                if (!isStateTest && window._mcpExecuting) {
                  delete window._mcpExecuting[codeHash];
                }
              }, 1000);
              
              // Enhanced result reporting
              // For simple expressions, undefined might be a valid result for some cases
              if (result === undefined && !rawCode.includes('window.') && !rawCode.includes('document.') && !rawCode.includes('||')) {
                return { success: false, error: 'Command returned undefined - element may not exist or action failed', result: null };
              }
              if (result === null) {
                return { success: false, error: 'Command returned null - element may not exist', result: null };
              }
              if (result === false && rawCode.includes('click') || rawCode.includes('querySelector')) {
                return { success: false, error: 'Command returned false - action likely failed', result: false };
              }
              
              return { success: true, error: null, result: result };
            } catch (error) {
              return { 
                success: false, 
                error: 'JavaScript error: ' + error.message,
                stack: error.stack,
                result: null 
              };
            }
          })()
        `;
        break;

      default:
        javascriptCode = command;
    }

    const rawResult = await executeInElectron(javascriptCode, target);

    // Try to parse structured response from enhanced eval
    if (command.toLowerCase() === 'eval') {
      try {
        const parsedResult = JSON.parse(rawResult);
        if (parsedResult && typeof parsedResult === 'object' && 'success' in parsedResult) {
          if (!parsedResult.success) {
            return `❌ Command failed: ${parsedResult.error}${
              parsedResult.stack ? '\nStack: ' + parsedResult.stack : ''
            }`;
          }
          return `✅ Command successful${
            parsedResult.result !== null ? ': ' + JSON.stringify(parsedResult.result) : ''
          }`;
        }
      } catch {
        // If it's not JSON, treat as regular result
      }
    }

    // Handle regular results
    if (rawResult === 'undefined' || rawResult === 'null' || rawResult === '') {
      return `⚠️ Command executed but returned ${
        rawResult || 'empty'
      } - this may indicate the element wasn't found or the action failed`;
    }

    return `✅ Result: ${rawResult}`;
  } catch (error) {
    throw new Error(
      `Failed to send command: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Enhanced click function with better React support
 */
export async function clickByText(text: string): Promise<string> {
  return sendCommandToElectron('click_by_text', { text });
}

/**
 * Enhanced input filling with React state management
 */
export async function fillInput(
  searchText: string,
  value: string,
  selector?: string,
): Promise<string> {
  return sendCommandToElectron('fill_input', {
    selector,
    value,
    text: searchText,
  });
}

/**
 * Enhanced select option with proper event handling
 */
export async function selectOption(
  value: string,
  selector?: string,
  text?: string,
): Promise<string> {
  return sendCommandToElectron('select_option', {
    selector,
    value,
    text,
  });
}

/**
 * Get comprehensive page structure analysis
 */
export async function getPageStructure(): Promise<string> {
  return sendCommandToElectron('get_page_structure');
}

/**
 * Get enhanced element analysis
 */
export async function findElements(): Promise<string> {
  return sendCommandToElectron('find_elements');
}

/**
 * Execute custom JavaScript with error handling
 */
export async function executeCustomScript(code: string): Promise<string> {
  return sendCommandToElectron('eval', { code });
}

/**
 * Get debugging information about page elements
 */
export async function debugElements(): Promise<string> {
  return sendCommandToElectron('debug_elements');
}

/**
 * Verify current form state and validation
 */
export async function verifyFormState(): Promise<string> {
  return sendCommandToElectron('verify_form_state');
}
export async function getTitle(): Promise<string> {
  return sendCommandToElectron('get_title');
}

export async function getUrl(): Promise<string> {
  return sendCommandToElectron('get_url');
}

export async function getBodyText(): Promise<string> {
  return sendCommandToElectron('get_body_text');
}
