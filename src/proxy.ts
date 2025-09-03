#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { InitializeResult } from './lib/types.js';
import { wpRequest } from './lib/wordpress-api.js';
import { logger, LogLevel } from './lib/utils.js';
import { cleanupExpiredTokens } from './lib/persistent-auth-config.js';
import { CONFIG } from './lib/config.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ServerCapabilitiesSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  SetLevelRequestSchema,
  CompleteRequestSchema,
  ListRootsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';

// Define request types
type ListToolsRequest = z.infer<typeof ListToolsRequestSchema>;
type CallToolRequest = z.infer<typeof CallToolRequestSchema>;
type ListResourcesRequest = z.infer<typeof ListResourcesRequestSchema>;
type ListResourceTemplatesRequest = z.infer<typeof ListResourceTemplatesRequestSchema>;
type ReadResourceRequest = z.infer<typeof ReadResourceRequestSchema>;
type SubscribeRequest = z.infer<typeof SubscribeRequestSchema>;
type UnsubscribeRequest = z.infer<typeof UnsubscribeRequestSchema>;
type ListPromptsRequest = z.infer<typeof ListPromptsRequestSchema>;
type GetPromptRequest = z.infer<typeof GetPromptRequestSchema>;
type SetLevelRequest = z.infer<typeof SetLevelRequestSchema>;
type CompleteRequest = z.infer<typeof CompleteRequestSchema>;
type ListRootsRequest = z.infer<typeof ListRootsRequestSchema>;

// Check Node.js version
const requiredNodeVersion = 18;
const currentNodeVersion = parseInt(process.version.slice(1).split('.')[0]);
if (currentNodeVersion < requiredNodeVersion) {
  logger.error(
    `This application requires Node.js version ${requiredNodeVersion} or higher.`,
    'SYSTEM'
  );
  logger.error(`Current version: ${process.version}`, 'SYSTEM');
  process.exit(1);
}

// Setup fetch polyfill for Node.js 18+ compatibility
async function setupFetchPolyfill(): Promise<void> {
  if (typeof globalThis.fetch !== 'function') {
    logger.info('Native fetch not available, loading node-fetch polyfill...', 'SYSTEM');
    try {
      const { default: nodeFetch } = await import('node-fetch');
      (globalThis as any).fetch = nodeFetch;
      logger.info('Successfully loaded node-fetch polyfill', 'SYSTEM');
    } catch (error) {
      logger.error(
        'Failed to load node-fetch polyfill. Please install node-fetch: npm install node-fetch',
        'SYSTEM'
      );
      logger.error(`Error: ${error instanceof Error ? error.message : String(error)}`, 'SYSTEM');
      process.exit(1);
    }
  } else {
    logger.info('Using native fetch API', 'SYSTEM');
  }
}

async function WordPressProxy() {
  // Setup fetch polyfill before doing anything else
  await setupFetchPolyfill();

  logger.info('Starting WordPress MCP Proxy with enhanced authentication', 'PROXY');

  // Generate a unique session ID for this proxy instance
  const sessionId = randomUUID();
  logger.info(`Generated session ID: ${sessionId}`, 'PROXY');

  // Initialize request ID counter for this session
  let requestIdCounter = 0;

  // Clean up any expired tokens on startup
  try {
    await cleanupExpiredTokens();
  } catch (error) {
    logger.warn('Error cleaning up expired tokens', 'PROXY', error);
  }

  // Helper function to add session information to WordPress requests
  interface WPRequestParams {
    method: string;
    [key: string]: unknown;
  }
  interface MCPRequest {
    id?: string | number;
    [key: string]: unknown;
  }
  const addSessionInfo = (wpRequestParams: WPRequestParams, mcpRequest: MCPRequest) => {
    // Increment the request ID counter for each new request
    requestIdCounter++;

    const sessionInfo = {
      id: requestIdCounter,
      session_id: sessionId,
      ...wpRequestParams,
    };

    logger.debug(`Session info being sent to WordPress:`, 'SESSION', {
      id: sessionInfo.id,
      session_id: sessionInfo.session_id,
      method: sessionInfo.method,
      original_mcp_id: mcpRequest.id || 'none',
    });

    return sessionInfo;
  };

  // Initialize the WordPress API connection (this will trigger OAuth flow if needed)
  logger.info('Initializing connection to WordPress API...', 'PROXY');
  const init = (await wpRequest(addSessionInfo({ method: 'initialize' }, {}))) as InitializeResult;

  const server = new Server(
    {
      name: init.serverInfo.name,
      version: init.serverInfo.version,
    },
    {
      capabilities: init.capabilities as any, // Type assertion to fix linter error
    }
  );

  const withLogging = (schema: string, handler: Function) => async (request: any) => {
    logger.debug(`Received ${schema} request`, 'MCP', request);
    logger.debug(
      `Adding session info - Session ID: ${sessionId}, MCP Request ID: ${request.id}`,
      'SESSION'
    );
    try {
      const response = await handler(request);
      logger.debug(`${schema} response sent`, 'MCP');
      return response;
    } catch (error) {
      logger.error(`Error handling ${schema} request`, 'MCP', error);
      throw error;
    }
  };

  // List Tools Handler
  server.setRequestHandler(
    ListToolsRequestSchema,
    withLogging('ListTools', async (request: ListToolsRequest) => {
      logger.debug('Processing ListToolsRequest', 'MCP');
      const response = await wpRequest(
        addSessionInfo(
          {
            method: 'tools/list',
            cursor: request.params?.cursor,
          },
          request
        )
      );
      return response;
    })
  );

  // Call Tool Handler
  server.setRequestHandler(
    CallToolRequestSchema,
    withLogging('CallTool', async (request: CallToolRequest) => {
      logger.debug('Processing CallToolRequest', 'MCP');
      const response = await wpRequest(
        addSessionInfo(
          {
            method: 'tools/call',
            name: request.params.name,
            arguments: request.params.arguments,
          },
          request
        )
      );
      return response;
    })
  );

  // List Resources Handler
  server.setRequestHandler(
    ListResourcesRequestSchema,
    withLogging('ListResources', async (request: ListResourcesRequest) => {
      logger.debug('Processing ListResourcesRequest', 'MCP');
      const response = await wpRequest(
        addSessionInfo(
          {
            method: 'resources/list',
            cursor: request.params?.cursor,
          },
          request
        )
      );
      return response;
    })
  );

  // List Resource Templates Handler
  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    withLogging('ListResourceTemplates', async (request: ListResourceTemplatesRequest) => {
      logger.debug('Processing ListResourceTemplatesRequest', 'MCP');
      const response = await wpRequest(
        addSessionInfo(
          {
            method: 'resources/templates/list',
            cursor: request.params?.cursor,
          },
          request
        )
      );
      return response;
    })
  );

  // Read Resource Handler
  server.setRequestHandler(
    ReadResourceRequestSchema,
    withLogging('ReadResource', async (request: ReadResourceRequest) => {
      logger.debug('Processing ReadResourceRequest', 'MCP');
      const response = await wpRequest(
        addSessionInfo(
          {
            method: 'resources/read',
            uri: request.params.uri,
          },
          request
        )
      );
      return response;
    })
  );

  // Subscribe Handler
  server.setRequestHandler(
    SubscribeRequestSchema,
    withLogging('Subscribe', async (request: SubscribeRequest) => {
      logger.debug('Processing SubscribeRequest', 'MCP');
      const response = await wpRequest(
        addSessionInfo(
          {
            method: 'resources/subscribe',
            uri: request.params.uri,
          },
          request
        )
      );
      return response;
    })
  );

  // Unsubscribe Handler
  server.setRequestHandler(
    UnsubscribeRequestSchema,
    withLogging('Unsubscribe', async (request: UnsubscribeRequest) => {
      logger.debug('Processing UnsubscribeRequest', 'MCP');
      const response = await wpRequest(
        addSessionInfo(
          {
            method: 'resources/unsubscribe',
            uri: request.params.uri,
          },
          request
        )
      );
      return response;
    })
  );

  // List Prompts Handler
  server.setRequestHandler(
    ListPromptsRequestSchema,
    withLogging('ListPrompts', async (request: ListPromptsRequest) => {
      logger.debug('Processing ListPromptsRequest', 'MCP');
      const response = await wpRequest(
        addSessionInfo(
          {
            method: 'prompts/list',
            cursor: request.params?.cursor,
          },
          request
        )
      );
      return response;
    })
  );

  // Get Prompt Handler
  server.setRequestHandler(
    GetPromptRequestSchema,
    withLogging('GetPrompt', async (request: GetPromptRequest) => {
      logger.debug('Processing GetPromptRequest', 'MCP');
      const response = await wpRequest(
        addSessionInfo(
          {
            method: 'prompts/get',
            name: request.params.name,
            arguments: request.params.arguments,
          },
          request
        )
      );
      return response;
    })
  );

  // Set Logging Level Handler
  server.setRequestHandler(
    SetLevelRequestSchema,
    withLogging('SetLevel', async (request: SetLevelRequest) => {
      logger.debug('Processing SetLevelRequest', 'MCP');
      const response = await wpRequest(
        addSessionInfo(
          {
            method: 'logging/setLevel',
            level: request.params.level,
          },
          request
        )
      );
      return response;
    })
  );

  // Complete Handler
  server.setRequestHandler(
    CompleteRequestSchema,
    withLogging('Complete', async (request: CompleteRequest) => {
      logger.debug('Processing CompleteRequest', 'MCP');
      const response = await wpRequest(
        addSessionInfo(
          {
            method: 'completion/complete',
            ref: request.params.ref,
            argument: request.params.argument,
          },
          request
        )
      );
      return response;
    })
  );

  // List Roots Handler
  server.setRequestHandler(
    ListRootsRequestSchema,
    withLogging('ListRoots', async (request: ListRootsRequest) => {
      logger.debug('Processing ListRootsRequest', 'MCP');
      const response = await wpRequest(
        addSessionInfo(
          {
            method: 'roots/list',
          },
          request
        )
      );
      return response;
    })
  );

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
