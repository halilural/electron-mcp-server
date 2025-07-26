import path from "path";

/**
 * Centralized test resource configuration
 * Defines all temporary directories and paths used across tests
 */
export const TEST_RESOURCES = {
  TEMP_DIR: path.join(process.cwd(), "temp"),
  TEST_TEMP_DIR: path.join(process.cwd(), "test-temp"),
  LOGS_DIR: path.join(process.cwd(), "logs"),
  ELECTRON_APPS_DIR: path.join(process.cwd(), "temp", "electron-apps"),
} as const;

/**
 * Create a test-specific temporary directory path
 */
export function createTestTempPath(testName?: string): string {
  const timestamp = Date.now();
  const suffix = testName ? `-${testName.replace(/[^a-zA-Z0-9]/g, "-")}` : "";
  return path.join(TEST_RESOURCES.TEST_TEMP_DIR, `test-${timestamp}${suffix}`);
}

/**
 * Create a test Electron app directory path
 */
export function createElectronAppPath(port: number): string {
  return path.join(
    TEST_RESOURCES.ELECTRON_APPS_DIR,
    `test-electron-${Date.now()}-${port}`
  );
}
