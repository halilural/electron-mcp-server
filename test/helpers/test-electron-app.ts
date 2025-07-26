import { spawn, ChildProcess } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "net";
import { createElectronAppDir, markResourceCleaned } from "../setup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface TestElectronApp {
  process: ChildProcess;
  port: number;
  cleanup: () => Promise<void>;
}

/**
 * Check if a port is available
 */
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(port, () => {
      server.once("close", () => resolve(true));
      server.close();
    });
    server.on("error", () => resolve(false));
  });
}

/**
 * Find an available port starting from the given port
 */
async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  while (port < startPort + 100) {
    // Check up to 100 ports
    if (await isPortAvailable(port)) {
      return port;
    }
    port++;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

/**
 * Create a minimal headless Electron app for testing
 */
export async function createTestElectronApp(
  port: number = 9222
): Promise<TestElectronApp> {
  // Find an available port starting from the requested port
  const availablePort = await findAvailablePort(port);

  // Create temporary directory for test app using centralized management
  const tempDir = createElectronAppDir(availablePort);
  await fs.mkdir(tempDir, { recursive: true });

  // Create minimal package.json
  const packageJson = {
    name: "test-electron-app",
    version: "1.0.0",
    main: "main.js",
    private: true,
  };
  await fs.writeFile(
    path.join(tempDir, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );

  // Create minimal main.js
  const mainJs = `// Test Electron App for MCP Server Testing
console.log('Starting Electron app...');

const electron = require('electron');
console.log('Electron module:', typeof electron);

const { app, BrowserWindow } = electron;
console.log('App object:', typeof app);
console.log('BrowserWindow object:', typeof BrowserWindow);

if (typeof app === 'undefined') {
  console.error('ERROR: app object is undefined');
  process.exit(1);
}

if (typeof app.commandLine === 'undefined') {
  console.error('ERROR: app.commandLine is undefined');
  process.exit(1);
}

console.log('Setting command line switches...');
app.commandLine.appendSwitch('remote-debugging-port', '${availablePort}');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-web-security');
console.log('Command line switches set successfully');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false, // Headless
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });

  mainWindow.loadFile('index.html');
  
  // Keep window hidden for headless testing
  mainWindow.on('ready-to-show', () => {
    console.log('[TEST-APP] Window ready, staying hidden for testing');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Log when remote debugging is ready
app.on('ready', () => {
  console.log('[TEST-APP] Electron app ready with remote debugging on port ' + ${availablePort});
  setTimeout(() => {
    console.log('Electron app ready with remote debugging');
  }, 1000);
});
`;
  await fs.writeFile(path.join(tempDir, "main.js"), mainJs);

  // Create minimal HTML with test elements
  const indexHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Test Electron App</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    .button { padding: 10px 20px; margin: 10px; background: #007acc; color: white; border: none; cursor: pointer; }
    .input { padding: 8px; margin: 10px; border: 1px solid #ccc; }
    .select { padding: 8px; margin: 10px; }
  </style>
</head>
<body>
  <h1 id="title">Test Electron App</h1>
  <p id="description">This is a test app for MCP server testing</p>
  
  <div id="buttons">
    <button id="test-button" class="button">Test Button</button>
    <button id="submit-button" class="button">Submit</button>
    <button id="cancel-button" class="button">Cancel</button>
  </div>
  
  <div id="forms">
    <input id="username-input" class="input" type="text" placeholder="Username" />
    <input id="password-input" class="input" type="password" placeholder="Password" />
    <input id="email-input" class="input" type="email" placeholder="Email" />
    
    <select id="country-select" class="select">
      <option value="">Select Country</option>
      <option value="us">United States</option>
      <option value="uk">United Kingdom</option>
      <option value="ca">Canada</option>
    </select>
  </div>
  
  <div id="output"></div>
  
  <script>
    // Add some interactive behavior for testing
    document.getElementById('test-button').addEventListener('click', () => {
      document.getElementById('output').innerHTML = '<p>Test button clicked!</p>';
      console.log('Test button clicked');
    });
    
    document.getElementById('submit-button').addEventListener('click', () => {
      const username = document.getElementById('username-input').value;
      const email = document.getElementById('email-input').value;
      document.getElementById('output').innerHTML = 
        '<p>Form submitted with username: ' + username + ', email: ' + email + '</p>';
      console.log('Form submitted:', { username, email });
    });
    
    // Make app state available for testing
    window.testAppState = {
      version: '1.0.0',
      ready: true,
      lastAction: null
    };
    
    // Update state on actions
    document.addEventListener('click', (e) => {
      window.testAppState.lastAction = {
        type: 'click',
        target: e.target.id || e.target.tagName,
        timestamp: Date.now()
      };
    });
    
    console.log('Test app loaded and ready');
  </script>
</body>
</html>
`;
  await fs.writeFile(path.join(tempDir, "index.html"), indexHtml);

  // Launch Electron with the test app
  const electronPath = process.platform === 'win32' 
    ? path.join(__dirname, "..", "..", "node_modules", ".bin", "electron.cmd")
    : path.join(__dirname, "..", "..", "node_modules", ".bin", "electron");
  
  // Check if local electron exists, fallback to system electron
  let finalElectronPath = electronPath;
  try {
    await fs.access(electronPath);
  } catch {
    // Fallback to system electron
    finalElectronPath = 'electron';
    console.log(`Local electron not found at ${electronPath}, using system electron`);
  }
  
  const electronProcess = spawn(finalElectronPath, [tempDir], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      NODE_ENV: "test",
    },
  });

  // Wait for the app to be ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `Test Electron app failed to start within 10 seconds on port ${availablePort}. Check if Electron is installed.`
        )
      );
    }, 10000);

    electronProcess.stdout?.on("data", (data) => {
      const output = data.toString();
      console.log(`[TEST-APP-STDOUT-${availablePort}]`, output.trim());
      if (output.includes("Electron app ready with remote debugging")) {
        clearTimeout(timeout);
        resolve();
      }
    });

    electronProcess.stderr?.on("data", (data) => {
      const error = data.toString();
      // Log all stderr for debugging, but ignore common warnings
      console.warn(`[TEST-APP-STDERR-${availablePort}]`, error.trim());
      if (
        !error.includes("WARNING") &&
        !error.includes("deprecated") &&
        error.includes("Error")
      ) {
        clearTimeout(timeout);
        reject(new Error(`Electron app failed to start: ${error}`));
      }
    });

    electronProcess.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    electronProcess.on("exit", (code) => {
      if (code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Test Electron app exited with code ${code}`));
      }
    });
  });

  // Give it a moment to fully initialize
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const cleanup = async () => {
    if (electronProcess && !electronProcess.killed) {
      electronProcess.kill("SIGTERM");

      // Wait for graceful shutdown
      await new Promise<void>((resolve) => {
        const forceKillTimeout = setTimeout(() => {
          if (!electronProcess.killed) {
            electronProcess.kill("SIGKILL");
          }
          resolve();
        }, 5000);

        electronProcess.on("exit", () => {
          clearTimeout(forceKillTimeout);
          resolve();
        });
      });
    }

    // Clean up temp directory using centralized management
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      markResourceCleaned(tempDir);
    } catch (error) {
      console.warn("Failed to clean up temp directory:", error);
    }
  };

  return {
    process: electronProcess,
    port: availablePort,
    cleanup,
  };
}

/**
 * Wait for Electron app to be discoverable via DevTools
 */
export async function waitForElectronApp(
  port: number = 9222,
  timeout: number = 10000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(`http://localhost:${port}/json`, {
        signal: AbortSignal.timeout(1000),
      });

      if (response.ok) {
        const targets = await response.json();
        const pageTargets = targets.filter(
          (target: any) => target.type === "page"
        );
        if (pageTargets.length > 0) {
          return true;
        }
      }
    } catch (error) {
      // Continue waiting
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}
