#!/usr/bin/env node

// Load environment variables from .env file
import { config } from 'dotenv';
config();

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { tools } from './tools.js';
import { handleToolCall } from './handlers.js';
import { logger } from './utils/logger.js';

// Create MCP server instance
const server = new Server(
  {
    name: 'electron-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  logger.debug('Listing tools request received');
  return { tools };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const start = Date.now();

  logger.info(`Tool call: ${request.params.name}`);
  logger.debug(`Tool call args:`, JSON.stringify(request.params.arguments, null, 2));

  const result = await handleToolCall(request);

  const duration = Date.now() - start;
  if (duration > 1000) {
    logger.warn(`Slow tool execution: ${request.params.name} took ${duration}ms`);
  }

  // Log result but truncate large base64 data to avoid spam
  if (logger.isEnabled(2)) {
    // Only if DEBUG level
    const logResult = { ...result };
    if (logResult.content && Array.isArray(logResult.content)) {
      logResult.content = logResult.content.map((item: any) => {
        if (
          item.type === 'text' &&
          item.text &&
          typeof item.text === 'string' &&
          item.text.length > 1000
        ) {
          return {
            ...item,
            text: item.text.substring(0, 100) + '... [truncated]',
          };
        }
        if (
          item.type === 'image' &&
          item.data &&
          typeof item.data === 'string' &&
          item.data.length > 100
        ) {
          return {
            ...item,
            data: item.data.substring(0, 50) + '... [base64 truncated]',
          };
        }
        return item;
      });
    }

    logger.debug(`Tool call result:`, JSON.stringify(logResult, null, 2));
  }

  return result;
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  logger.info('Electron MCP Server starting...');
  await server.connect(transport);
  logger.info('Electron MCP Server running on stdio');
  logger.info('Available tools:', tools.map((t) => t.name).join(', '));
}

main().catch((error) => {
  logger.error('Server error:', error);
  process.exit(1);
});
