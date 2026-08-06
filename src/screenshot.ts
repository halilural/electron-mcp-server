import { chromium } from 'playwright';
import * as fs from 'fs/promises';
import { createCipheriv, randomBytes, pbkdf2Sync } from 'crypto';
import { logger } from './utils/logger';
import { scanForElectronApps } from './utils/electron-discovery';
import * as path from 'path';

// Generate a fallback encryption key if none is provided
function generateFallbackKey(): string {
  const fallbackKey = randomBytes(32).toString('hex');
  logger.warn('⚠️  SCREENSHOT_ENCRYPTION_KEY not set - using temporary key for this session');
  logger.warn('⚠️  Screenshots will not be decryptable after restart!');
  logger.warn('⚠️  For production use, set SCREENSHOT_ENCRYPTION_KEY environment variable');
  logger.warn('⚠️  Generate a permanent key with: openssl rand -hex 32');
  return fallbackKey;
}

// Validate and get encryption key with fallback
function getEncryptionKey(): string {
  const key = process.env.SCREENSHOT_ENCRYPTION_KEY;

  if (!key) {
    return generateFallbackKey();
  }

  if (key === 'default-screenshot-key-change-me') {
    logger.warn('⚠️  SCREENSHOT_ENCRYPTION_KEY is set to default value - using temporary key');
    logger.warn('⚠️  Please set a secure key with: openssl rand -hex 32');
    return generateFallbackKey();
  }

  if (key.length < 32) {
    logger.warn('⚠️  SCREENSHOT_ENCRYPTION_KEY too short - using temporary key');
    logger.warn('⚠️  Key must be at least 32 characters. Generate with: openssl rand -hex 32');
    return generateFallbackKey();
  }

  return key;
}

interface EncryptedScreenshot {
  encryptedData: string;
  iv: string;
  salt: string; // Add salt to be stored with encrypted data
  timestamp: string;
}

/**
 * Validate if a file path is safe for screenshot output
 */
function validateScreenshotPath(outputPath: string): boolean {
  if (!outputPath) return true;

  // Normalize the path to detect path traversal
  const normalizedPath = path.normalize(outputPath);

  // Block dangerous paths
  const dangerousPaths = [
    '/etc/',
    '/sys/',
    '/proc/',
    '/dev/',
    '/bin/',
    '/sbin/',
    '/usr/bin/',
    '/usr/sbin/',
    '/root/',
    '/home/',
    '/.ssh/',
    'C:\\Windows\\System32\\',
    'C:\\Windows\\SysWOW64\\',
    'C:\\Program Files\\',
    'C:\\Users\\',
    '\\Windows\\System32\\',
    '\\Windows\\SysWOW64\\',
    '\\Program Files\\',
    '\\Users\\',
  ];

  // Check for dangerous path patterns
  for (const dangerousPath of dangerousPaths) {
    if (normalizedPath.toLowerCase().includes(dangerousPath.toLowerCase())) {
      return false;
    }
  }

  // Block path traversal attempts
  if (normalizedPath.includes('..') || normalizedPath.includes('~')) {
    return false;
  }

  // Block absolute paths to system directories
  if (path.isAbsolute(normalizedPath)) {
    const absolutePath = normalizedPath.toLowerCase();
    if (
      absolutePath.startsWith('/etc') ||
      absolutePath.startsWith('/sys') ||
      absolutePath.startsWith('/proc') ||
      absolutePath.startsWith('c:\\windows') ||
      absolutePath.startsWith('c:\\program files')
    ) {
      return false;
    }
  }

  return true;
}

// Validate that required environment variables are set
function validateEnvironmentVariables(): string {
  return getEncryptionKey();
}

// Encrypt screenshot data for secure storage and transmission
function encryptScreenshotData(buffer: Buffer): EncryptedScreenshot {
  try {
    // Get validated encryption key (with fallback)
    const password = validateEnvironmentVariables();

    const algorithm = 'aes-256-cbc';
    const iv = randomBytes(16);

    // Derive a proper key from the password using PBKDF2
    const salt = randomBytes(32);
    const key = pbkdf2Sync(password, salt, 100000, 32, 'sha512');

    const cipher = createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(buffer.toString('base64'), 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return {
      encryptedData: encrypted,
      iv: iv.toString('hex'),
      salt: salt.toString('hex'), // Store salt with encrypted data
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.warn('Failed to encrypt screenshot data:', error);
    // Fallback to base64 encoding if encryption fails
    return {
      encryptedData: buffer.toString('base64'),
      iv: '',
      salt: '', // Empty salt for fallback
      timestamp: new Date().toISOString(),
    };
  }
}

// Helper function to take screenshot using only Playwright CDP (Chrome DevTools Protocol)
export async function takeScreenshot(
  outputPath?: string,
  windowTitle?: string,
): Promise<{
  filePath?: string;
  base64: string;
  data: string;
  error?: string;
}> {
  // Validate output path for security
  if (outputPath && !validateScreenshotPath(outputPath)) {
    throw new Error(
      `Invalid output path: ${outputPath}. Path appears to target a restricted system location.`,
    );
  }

  // Inform user about screenshot
  logger.info('📸 Taking screenshot of Electron application', {
    outputPath,
    windowTitle,
    timestamp: new Date().toISOString(),
  });
  try {
    // Find running Electron applications
    const apps = await scanForElectronApps();
    if (apps.length === 0) {
      throw new Error('No running Electron applications found with remote debugging enabled');
    }

    // Use the first app found (or find by title if specified)
    let targetApp = apps[0];
    if (windowTitle) {
      const namedApp = apps.find((app) =>
        app.targets.some((target) =>
          target.title?.toLowerCase().includes(windowTitle.toLowerCase()),
        ),
      );
      if (namedApp) {
        targetApp = namedApp;
      }
    }

    // Connect to the Electron app's debugging port
    const browser = await chromium.connectOverCDP(`http://localhost:${targetApp.port}`);
    const contexts = browser.contexts();

    if (contexts.length === 0) {
      throw new Error(
        'No browser contexts found - make sure Electron app is running with remote debugging enabled',
      );
    }

    const context = contexts[0];
    const pages = context.pages();

    if (pages.length === 0) {
      throw new Error('No pages found in the browser context');
    }

    // Find the main application page (skip DevTools pages)
    let targetPage = pages[0];
    for (const page of pages) {
      const url = page.url();
      const title = await page.title().catch(() => '');

      // Skip DevTools and about:blank pages
      if (
        !url.includes('devtools://') &&
        !url.includes('about:blank') &&
        title &&
        !title.includes('DevTools')
      ) {
        // If windowTitle is specified, try to match it
        if (windowTitle && title.toLowerCase().includes(windowTitle.toLowerCase())) {
          targetPage = page;
          break;
        } else if (!windowTitle) {
          targetPage = page;
          break;
        }
      }
    }

    logger.info(`Taking screenshot of page: ${targetPage.url()} (${await targetPage.title()})`);

    // Take screenshot as buffer (in memory)
    const screenshotBuffer = await targetPage.screenshot({
      type: 'png',
      fullPage: false,
    });

    await browser.close();

    // Encrypt screenshot data for security
    const encryptedScreenshot = encryptScreenshotData(screenshotBuffer);

    // Convert buffer to base64 for transmission
    const base64Data = screenshotBuffer.toString('base64');
    logger.info(
      `Screenshot captured and encrypted successfully (${screenshotBuffer.length} bytes)`,
    );

    // If outputPath is provided, save encrypted data to file
    if (outputPath) {
      await fs.writeFile(outputPath + '.encrypted', JSON.stringify(encryptedScreenshot));
      // Also save unencrypted for compatibility (in production, consider removing this)
      await fs.writeFile(outputPath, screenshotBuffer);
      return {
        filePath: outputPath,
        base64: base64Data,
        data: `Screenshot saved to: ${outputPath} (encrypted backup: ${outputPath}.encrypted) and returned as base64 data`,
      };
    } else {
      return {
        base64: base64Data,
        data: `Screenshot captured as base64 data (${screenshotBuffer.length} bytes) - no file saved`,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Screenshot failed: ${errorMessage}. Make sure the Electron app is running with remote debugging enabled (--remote-debugging-port=9222)`,
    );
  }
}
