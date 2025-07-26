import { beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { TestCleanup } from "./utils/cleanup.js";
import { logger } from "../src/utils/logger.js";
import { promises as fs } from "fs";
import path from "path";
import {
  TEST_RESOURCES,
  createTestTempPath,
  createElectronAppPath,
} from "./config.js";

/**
 * Global test setup and teardown
 * This will run once before all test files and once after all test files
 */

// Track active test resources for proper cleanup
const activeResources = new Set<string>();

/**
 * Create a test-specific temporary directory
 */
export function createTestTempDir(testName?: string): string {
  const tempDir = createTestTempPath(testName);
  activeResources.add(tempDir);
  return tempDir;
}

/**
 * Create a test Electron app directory
 */
export function createElectronAppDir(port: number): string {
  const appDir = createElectronAppPath(port);
  activeResources.add(appDir);
  return appDir;
}

/**
 * Mark a resource as no longer active (cleaned up)
 */
export function markResourceCleaned(resourcePath: string): void {
  activeResources.delete(resourcePath);
}

beforeAll(async () => {
  logger.info("🚀 Starting test suite - Global setup");

  // Clean up any leftover artifacts from previous test runs
  await TestCleanup.cleanup({
    removeLogsDir: true,
    removeTempDir: true,
    preserveKeys: false,
  });

  // Ensure all test resource directories exist
  await fs.mkdir(TEST_RESOURCES.TEMP_DIR, { recursive: true });
  await fs.mkdir(TEST_RESOURCES.TEST_TEMP_DIR, { recursive: true });
  await fs.mkdir(TEST_RESOURCES.LOGS_DIR, { recursive: true });
  await fs.mkdir(TEST_RESOURCES.ELECTRON_APPS_DIR, { recursive: true });

  logger.info("📁 Test resource directories initialized");
});

beforeEach(async () => {
  // Clear active resources tracking for each test
  activeResources.clear();
});

afterEach(async () => {
  // Clean up any resources that weren't explicitly cleaned by the test
  for (const resourcePath of activeResources) {
    try {
      await fs.rm(resourcePath, { recursive: true, force: true });
      logger.info(
        `🧹 Auto-cleaned test resource: ${path.basename(resourcePath)}`
      );
    } catch (error) {
      logger.warn(`Failed to auto-clean resource ${resourcePath}:`, error);
    }
  }
  activeResources.clear();
});

afterAll(async () => {
  logger.info("🏁 Test suite completed - Global cleanup");

  // Get cleanup size for reporting
  const cleanupSize = TestCleanup.getCleanupSize();
  if (cleanupSize.total > 0) {
    const sizeMB = (cleanupSize.total / 1024 / 1024).toFixed(2);
    logger.info(`🧹 Cleaning up ${sizeMB}MB of test artifacts`);
  }

  // Clean up all test artifacts
  await TestCleanup.cleanup({
    removeLogsDir: true,
    removeTempDir: true,
    preserveKeys: false,
  });
});
