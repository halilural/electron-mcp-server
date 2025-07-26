import { z } from 'zod';

// Schema definitions for tool inputs
export const SendCommandToElectronSchema = z.object({
  command: z.string().describe('Command to send to the Electron process'),
  args: z.any().optional().describe('Arguments for the command'),
});

export const TakeScreenshotSchema = z.object({
  outputPath: z
    .string()
    .optional()
    .describe('Path to save the screenshot (optional, defaults to temp directory)'),
  windowTitle: z.string().optional().describe('Specific window title to screenshot (optional)'),
});

export const ReadElectronLogsSchema = z.object({
  logType: z
    .enum(['console', 'main', 'renderer', 'all'])
    .optional()
    .describe('Type of logs to read'),
  lines: z.number().optional().describe('Number of recent lines to read (default: 100)'),
  follow: z.boolean().optional().describe('Whether to follow/tail the logs'),
});

export const GetElectronWindowInfoSchema = z.object({
  includeChildren: z.boolean().optional().describe('Include child windows information'),
});

// Type helper for tool input schema
export type ToolInput = {
  type: 'object';
  properties: Record<string, any>;
  required?: string[];
};
