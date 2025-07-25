import {
  executeInElectron,
  findElectronTarget,
} from "./electron-connection.js";
import {
  generateFindElementsCommand,
  generateClickByTextCommand,
} from "./electron-commands.js";
import {
  generateFillInputCommand,
  generateSelectOptionCommand,
  generatePageStructureCommand,
} from "./electron-input-commands.js";
import { logger } from "./logger.js";

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
export async function sendCommandToElectron(
  command: string,
  args?: CommandArgs
): Promise<string> {
  try {
    const target = await findElectronTarget();
    let javascriptCode: string;

    switch (command.toLowerCase()) {
      case "get_title":
        javascriptCode = "document.title";
        break;

      case "get_url":
        javascriptCode = "window.location.href";
        break;

      case "get_body_text":
        javascriptCode = "document.body.innerText.substring(0, 500)";
        break;

      case "click_button":
        javascriptCode = `
          const button = document.querySelector('${
            args?.selector || "button"
          }');
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

      case "find_elements":
        javascriptCode = generateFindElementsCommand();
        break;

      case "click_by_text":
        javascriptCode = generateClickByTextCommand(args?.text || "");
        break;

      case "fill_input":
        javascriptCode = generateFillInputCommand(
          args?.selector || "",
          args?.value || args?.text || "",
          args?.text || args?.placeholder || ""
        );
        break;

      case "select_option":
        javascriptCode = generateSelectOptionCommand(
          args?.selector || "",
          args?.value || "",
          args?.text || ""
        );
        break;

      case "get_page_structure":
        javascriptCode = generatePageStructureCommand();
        break;

      case "debug_elements":
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

      case "verify_form_state":
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

      case "console_log":
        javascriptCode = `console.log('MCP Command:', '${
          args?.message || "Hello from MCP!"
        }'); 'Console message sent'`;
        break;

      case "eval":
        const rawCode = typeof args === "string" ? args : args?.code || command;
        // Enhanced eval with better error handling and result reporting
        javascriptCode = `
          (function() {
            try {
              // Prevent rapid execution of the same code
              const codeHash = '${Buffer.from(rawCode)
                .toString("base64")
                .slice(0, 10)}';
              if (window._mcpExecuting && window._mcpExecuting[codeHash]) {
                return { success: false, error: 'Code already executing', result: null };
              }
              
              window._mcpExecuting = window._mcpExecuting || {};
              window._mcpExecuting[codeHash] = true;
              
              let result;
              ${rawCode.trim().startsWith("() =>") || rawCode.trim().startsWith("function") 
                ? `result = (${rawCode})();`
                : `result = (function() { ${rawCode} })();`
              }
              
              setTimeout(() => {
                if (window._mcpExecuting) {
                  delete window._mcpExecuting[codeHash];
                }
              }, 1000);
              
              // Enhanced result reporting
              if (result === undefined) {
                return { success: false, error: 'Command returned undefined - element may not exist or action failed', result: null };
              }
              if (result === null) {
                return { success: false, error: 'Command returned null - element may not exist', result: null };
              }
              if (result === false) {
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
    if (command.toLowerCase() === "eval") {
      try {
        const parsedResult = JSON.parse(rawResult);
        if (parsedResult && typeof parsedResult === 'object' && 'success' in parsedResult) {
          if (!parsedResult.success) {
            return `❌ Command failed: ${parsedResult.error}${parsedResult.stack ? '\nStack: ' + parsedResult.stack : ''}`;
          }
          return `✅ Command successful${parsedResult.result !== null ? ': ' + JSON.stringify(parsedResult.result) : ''}`;
        }
      } catch (e) {
        // If it's not JSON, treat as regular result
      }
    }
    
    // Handle regular results
    if (rawResult === 'undefined' || rawResult === 'null' || rawResult === '') {
      return `⚠️ Command executed but returned ${rawResult || 'empty'} - this may indicate the element wasn't found or the action failed`;
    }
    
    return `✅ Result: ${rawResult}`;
  } catch (error) {
    throw new Error(
      `Failed to send command: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Enhanced click function with better React support
 */
export async function clickByText(text: string): Promise<string> {
  return sendCommandToElectron("click_by_text", { text });
}

/**
 * Enhanced input filling with React state management
 */
export async function fillInput(
  searchText: string,
  value: string,
  selector?: string
): Promise<string> {
  return sendCommandToElectron("fill_input", {
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
  text?: string
): Promise<string> {
  return sendCommandToElectron("select_option", {
    selector,
    value,
    text,
  });
}

/**
 * Get comprehensive page structure analysis
 */
export async function getPageStructure(): Promise<string> {
  return sendCommandToElectron("get_page_structure");
}

/**
 * Get enhanced element analysis
 */
export async function findElements(): Promise<string> {
  return sendCommandToElectron("find_elements");
}

/**
 * Execute custom JavaScript with error handling
 */
export async function executeCustomScript(code: string): Promise<string> {
  return sendCommandToElectron("eval", { code });
}

/**
 * Get debugging information about page elements
 */
export async function debugElements(): Promise<string> {
  return sendCommandToElectron("debug_elements");
}

/**
 * Verify current form state and validation
 */
export async function verifyFormState(): Promise<string> {
  return sendCommandToElectron("verify_form_state");
}
export async function getTitle(): Promise<string> {
  return sendCommandToElectron("get_title");
}

export async function getUrl(): Promise<string> {
  return sendCommandToElectron("get_url");
}

export async function getBodyText(): Promise<string> {
  return sendCommandToElectron("get_body_text");
}
