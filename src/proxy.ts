#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { logger } from './lib/utils.js';
import { cleanupExpiredTokens } from './lib/persistent-auth-config.js';
import { validateNodeVersion } from './lib/node-utils.js';
import { setupFetchPolyfill } from './lib/fetch-utils.js';
import { detectTransportType } from './lib/transport-detection.js';
import { createSessionContext } from './lib/session-utils.js';
import { createWrappedHandler, HANDLER_CONFIGS } from './lib/request-handler-factory.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  SetLevelRequestSchema,
  CompleteRequestSchema,
  ListRootsRequestSchema,
} from './lib/mcp-types.js';


// Check Node.js version
validateNodeVersion(18);


async function WordPressProxy() {
  // Setup fetch polyfill before doing anything else
  await setupFetchPolyfill();

  logger.info('Starting WordPress MCP Proxy with enhanced authentication', 'PROXY');

  // Clean up any expired tokens on startup
  try {
    await cleanupExpiredTokens();
  } catch (error) {
    logger.warn('Error cleaning up expired tokens', 'PROXY', error);
  }

  // Create session context
  const sessionContext = createSessionContext();

  // Detect transport type and initialize connection
  const { initResult } = await detectTransportType(sessionContext);

  const server = new Server(
    {
      name: initResult.serverInfo.name,
      version: initResult.serverInfo.version,
    },
    {
      capabilities: initResult.capabilities as any, // Type assertion to fix linter error
    }
  );

  // Register all MCP request handlers using the factory
  server.setRequestHandler(ListToolsRequestSchema, createWrappedHandler(HANDLER_CONFIGS.listTools, sessionContext));
  server.setRequestHandler(CallToolRequestSchema, createWrappedHandler(HANDLER_CONFIGS.callTool, sessionContext));
  server.setRequestHandler(ListResourcesRequestSchema, createWrappedHandler(HANDLER_CONFIGS.listResources, sessionContext));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, createWrappedHandler(HANDLER_CONFIGS.listResourceTemplates, sessionContext));
  server.setRequestHandler(ReadResourceRequestSchema, createWrappedHandler(HANDLER_CONFIGS.readResource, sessionContext));
  server.setRequestHandler(SubscribeRequestSchema, createWrappedHandler(HANDLER_CONFIGS.subscribe, sessionContext));
  server.setRequestHandler(UnsubscribeRequestSchema, createWrappedHandler(HANDLER_CONFIGS.unsubscribe, sessionContext));
  server.setRequestHandler(ListPromptsRequestSchema, createWrappedHandler(HANDLER_CONFIGS.listPrompts, sessionContext));
  server.setRequestHandler(GetPromptRequestSchema, createWrappedHandler(HANDLER_CONFIGS.getPrompt, sessionContext));
  server.setRequestHandler(SetLevelRequestSchema, createWrappedHandler(HANDLER_CONFIGS.setLevel, sessionContext));
  server.setRequestHandler(CompleteRequestSchema, createWrappedHandler(HANDLER_CONFIGS.complete, sessionContext));
  server.setRequestHandler(ListRootsRequestSchema, createWrappedHandler(HANDLER_CONFIGS.listRoots, sessionContext));

  const transport = new StdioServerTransport();
  // Connect to the transport
  server
    .connect(transport)
    .then(() => {
      logger.info('MCP server connected to transport successfully', 'PROXY');
    })
    .catch(error => {
      logger.error('Error starting MCP server', 'PROXY', error);
      process.exit(1);
    });
}

WordPressProxy();
