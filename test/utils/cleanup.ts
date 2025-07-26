import { rmSync, existsSync } from "fs";
import { join, basename } from "path";
import { logger } from "../../src/utils/logger.js";
import { TEST_RESOURCES } from "../config.js";

export interface CleanupOptions {
  removeLogsDir?: boolean;
  removeTempDir?: boolean;
  preserveKeys?: boolean;
}

/**
 * Clean up test artifacts and temporary files
 * Uses centralized resource paths from config.js
 */
export class TestCleanup {
  // Use centralized resource paths (convert absolute to relative for backwards compatibility)
  private static readonly LOG_DIR = basename(TEST_RESOURCES.LOGS_DIR);
  private static readonly TEMP_DIR = basename(TEST_RESOURCES.TEMP_DIR);
  private static readonly TEST_TEMP_DIR = basename(
    TEST_RESOURCES.TEST_TEMP_DIR
  );

  /**
   * Perform comprehensive cleanup of test artifacts
   */
  static async cleanup(options: CleanupOptions = {}) {
    const {
      removeLogsDir = true,
      removeTempDir = true,
      preserveKeys = false,
    } = options;

    try {
      // Clean up logs directory
      if (removeLogsDir && existsSync(this.LOG_DIR)) {
        if (preserveKeys) {
          // Only remove log files, preserve encryption keys
          this.cleanupLogsPreservingKeys();
        } else {
          // Remove entire logs directory
          rmSync(this.LOG_DIR, { recursive: true, force: true });
          logger.info(`🧹 Cleaned up ${this.LOG_DIR} directory`);
        }
      }

      // Clean up temp directories
      if (removeTempDir) {
        [this.TEMP_DIR, this.TEST_TEMP_DIR].forEach((dir) => {
          if (existsSync(dir)) {
            rmSync(dir, { recursive: true, force: true });
            logger.info(`🧹 Cleaned up ${dir} directory`);
          }
        });
      }
    } catch (error) {
      logger.error("Failed to cleanup test artifacts:", error);
      // Don't throw - cleanup failures shouldn't break tests
    }
  }

  /**
   * Clean up only log files while preserving encryption keys
   */
  private static cleanupLogsPreservingKeys() {
    try {
      const securityDir = join(this.LOG_DIR, "security");
      if (existsSync(securityDir)) {
        const fs = require("fs");
        const files = fs.readdirSync(securityDir);

        files.forEach((file: string) => {
          if (file.endsWith(".log")) {
            const filePath = join(securityDir, file);
            rmSync(filePath, { force: true });
            logger.info(`🧹 Cleaned up log file: ${filePath}`);
          }
        });
      }
    } catch (error) {
      logger.error("Failed to cleanup log files:", error);
    }
  }

  /**
   * Clean up specific temporary directories created by tests
   */
  static cleanupTestTemp(testId?: string) {
    try {
      if (testId) {
        const testTempPath = join(this.TEST_TEMP_DIR, testId);
        if (existsSync(testTempPath)) {
          rmSync(testTempPath, { recursive: true, force: true });
          logger.info(`🧹 Cleaned up test temp directory: ${testTempPath}`);
        }
      } else if (existsSync(this.TEST_TEMP_DIR)) {
        rmSync(this.TEST_TEMP_DIR, { recursive: true, force: true });
        logger.info(`🧹 Cleaned up all test temp directories`);
      }
    } catch (error) {
      logger.error("Failed to cleanup test temp directories:", error);
    }
  }

  /**
   * Get size of artifacts that would be cleaned up
   */
  static getCleanupSize(): { logs: number; temp: number; total: number } {
    let logsSize = 0;
    let tempSize = 0;

    try {
      if (existsSync(this.LOG_DIR)) {
        logsSize = this.getDirectorySize(this.LOG_DIR);
      }

      [this.TEMP_DIR, this.TEST_TEMP_DIR].forEach((dir) => {
        if (existsSync(dir)) {
          tempSize += this.getDirectorySize(dir);
        }
      });
    } catch (error) {
      logger.error("Failed to calculate cleanup size:", error);
    }

    return {
      logs: logsSize,
      temp: tempSize,
      total: logsSize + tempSize,
    };
  }

  /**
   * Calculate directory size in bytes
   */
  private static getDirectorySize(dirPath: string): number {
    const fs = require("fs");
    const path = require("path");
    let totalSize = 0;

    try {
      const items = fs.readdirSync(dirPath);

      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stats = fs.statSync(itemPath);

        if (stats.isDirectory()) {
          totalSize += this.getDirectorySize(itemPath);
        } else {
          totalSize += stats.size;
        }
      }
    } catch (error) {
      // Directory might not exist or be accessible
    }

    return totalSize;
  }
}
