#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { InitializeResult } from './lib/types.js';
import { wpRequest, getSessionId } from './lib/wordpress-api.js';
import { logger, LogLevel } from './lib/utils.js';
import { cleanupExpiredTokens } from './lib/persistent-auth-config.js';
import { CONFIG } from './lib/config.js';
import { isAPIError, APIError } from './lib/oauth-types.js';
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

/**
 * Maps HTTP status codes to MCP JSON-RPC error codes
 * Based on the MCP error codes from RestTransport.php
 */
function mapHttpStatusToMcpCode(statusCode: number): number {
  // MCP error codes (matching McpErrorFactory constants)
  const MCP_ERROR_CODES = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,
    UNAUTHORIZED: -32010,
    PERMISSION_DENIED: -32008,
  };

  switch (statusCode) {
    case 400: // Bad Request
      return MCP_ERROR_CODES.INVALID_REQUEST;
    case 401: // Unauthorized
      return MCP_ERROR_CODES.UNAUTHORIZED;
    case 403: // Forbidden
      return MCP_ERROR_CODES.PERMISSION_DENIED;
    case 404: // Not Found
      return MCP_ERROR_CODES.METHOD_NOT_FOUND;
    case 422: // Unprocessable Entity
      return MCP_ERROR_CODES.INVALID_PARAMS;
    case 500: // Internal Server Error
    case 502: // Bad Gateway
    case 503: // Service Unavailable
    case 504: // Gateway Timeout
    default:
      return MCP_ERROR_CODES.INTERNAL_ERROR;
  }
}

/**
 * Converts an APIError to MCP error response format
 */
function convertAPIErrorToMcpError(error: APIError) {
  return {
    error: {
      code: mapHttpStatusToMcpCode(error.statusCode),
      message: error.message,
      data: {
        statusCode: error.statusCode,
        endpoint: error.endpoint,
        response: error.response,
      },
    },
  };
}

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

  // Session ID will be provided by WordPress server after initialization
  let sessionId: string | null = null;
  logger.info('Proxy started - session ID will be obtained from WordPress server', 'PROXY');

  // Initialize request ID counter for this session
  let requestIdCounter = 0;

  // Transport type detection - will be determined during initialization
  let transportType: 'jsonrpc' | 'simple' | null = null;

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

    // Create proper MCP JSON-RPC format
    const { method, ...params } = wpRequestParams;
    const mcpMessage = {
      jsonrpc: '2.0',
      method: method,
      id: mcpRequest.id || requestIdCounter, // Use original MCP request ID
      params: {
        ...params,
        // Add internal tracking for WordPress
        _proxy_request_id: requestIdCounter,
      },
    };

    logger.debug(`MCP JSON-RPC message being sent to WordPress:`, 'SESSION', {
      jsonrpc: mcpMessage.jsonrpc,
      method: mcpMessage.method,
      id: mcpMessage.id,
      original_mcp_id: mcpRequest.id || 'none',
      session_id: sessionId || 'not-yet-obtained',
    });

    return mcpMessage;
  };

  // Helper function to prepare request based on transport type
  const prepareRequest = (wpRequestParams: WPRequestParams, mcpRequest: MCPRequest) => {
    if (transportType === 'jsonrpc') {
      // Use full JSON-RPC format
      return addSessionInfo(wpRequestParams, mcpRequest);
    } else {
      // Use simple format (just the params)
      return wpRequestParams;
    }
  };

  // Initialize the WordPress API connection with transport detection
  logger.info('Initializing connection to WordPress API with transport detection...', 'PROXY');
  
  let init: InitializeResult;
  
  try {
    // First, try JSON-RPC format
    logger.info('Attempting JSON-RPC transport...', 'PROXY');
    const initMessage = addSessionInfo({ method: 'initialize' }, {});
    const initResponse = await wpRequest(initMessage, true); // Use JSON-RPC
    init = initResponse as InitializeResult;
    transportType = 'jsonrpc';
    logger.info('✅ JSON-RPC transport detected and working', 'PROXY');
  } catch (error) {
    // If JSON-RPC fails, try simple format
    logger.warn('JSON-RPC transport failed, trying simple transport...', 'PROXY');
    logger.debug('JSON-RPC error:', 'PROXY', error);
    
    try {
      const simpleInitRequest = { method: 'initialize' };
      const initResponse = await wpRequest(simpleInitRequest, false); // Use simple format
      init = initResponse as InitializeResult;
      transportType = 'simple';
      logger.info('✅ Simple transport detected and working', 'PROXY');
    } catch (simpleError) {
      logger.error('Both JSON-RPC and simple transports failed', 'PROXY', simpleError);
      throw new Error('Unable to establish connection with either transport type');
    }
  }
  
  // Get the session ID that WordPress provided
  sessionId = getSessionId();
  if (sessionId) {
    logger.info(`Using session ID from WordPress: ${sessionId}`, 'PROXY');
  } else {
    logger.warn('No session ID received from WordPress - continuing without session', 'PROXY');
  }
  
  logger.info(`WordPress connection initialized successfully using ${transportType} transport`, 'PROXY');

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
      
      // Convert APIError to proper MCP error format
      if (isAPIError(error)) {
        logger.debug(`Converting APIError to MCP error format for ${schema}`, 'MCP', {
          statusCode: error.statusCode,
          endpoint: error.endpoint,
          message: error.message,
        });
        return convertAPIErrorToMcpError(error);
      }
      
      // Re-throw non-API errors (they should be handled by the MCP SDK)
      throw error;
    }
  };

  // List Tools Handler
  server.setRequestHandler(
    ListToolsRequestSchema,
    withLogging('ListTools', async (request: ListToolsRequest) => {
      logger.debug('Processing ListToolsRequest', 'MCP');
      const requestData = prepareRequest(
        {
          method: 'tools/list',
          cursor: request.params?.cursor,
        },
        request
      );
      const response = await wpRequest(requestData, transportType === 'jsonrpc');
      return response;
    })
  );

  // Call Tool Handler
  server.setRequestHandler(
    CallToolRequestSchema,
    withLogging('CallTool', async (request: CallToolRequest) => {
      logger.debug('Processing CallToolRequest', 'MCP');
      const requestData = prepareRequest(
        {
          method: 'tools/call',
          name: request.params.name,
          arguments: request.params.arguments,
        },
        request
      );
      const response = await wpRequest(requestData, transportType === 'jsonrpc');
      return response;
    })
  );

  // List Resources Handler
  server.setRequestHandler(
    ListResourcesRequestSchema,
    withLogging('ListResources', async (request: ListResourcesRequest) => {
      logger.debug('Processing ListResourcesRequest', 'MCP');
      const requestData = prepareRequest(
        {
          method: 'resources/list',
          cursor: request.params?.cursor,
        },
        request
      );
      const response = await wpRequest(requestData, transportType === 'jsonrpc');
      return response;
    })
  );

  // List Resource Templates Handler
  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    withLogging('ListResourceTemplates', async (request: ListResourceTemplatesRequest) => {
      logger.debug('Processing ListResourceTemplatesRequest', 'MCP');
      const requestData = prepareRequest(
        {
          method: 'resources/templates/list',
          cursor: request.params?.cursor,
        },
        request
      );
      const response = await wpRequest(requestData, transportType === 'jsonrpc');
      return response;
    })
  );

  // Read Resource Handler
  server.setRequestHandler(
    ReadResourceRequestSchema,
    withLogging('ReadResource', async (request: ReadResourceRequest) => {
      logger.debug('Processing ReadResourceRequest', 'MCP');
      const requestData = prepareRequest(
        {
          method: 'resources/read',
          uri: request.params.uri,
        },
        request
      );
      const response = await wpRequest(requestData, transportType === 'jsonrpc');
      return response;
    })
  );

  // Subscribe Handler
  server.setRequestHandler(
    SubscribeRequestSchema,
    withLogging('Subscribe', async (request: SubscribeRequest) => {
      logger.debug('Processing SubscribeRequest', 'MCP');
      const requestData = prepareRequest(
        {
          method: 'resources/subscribe',
          uri: request.params.uri,
        },
        request
      );
      const response = await wpRequest(requestData, transportType === 'jsonrpc');
      return response;
    })
  );

  // Unsubscribe Handler
  server.setRequestHandler(
    UnsubscribeRequestSchema,
    withLogging('Unsubscribe', async (request: UnsubscribeRequest) => {
      logger.debug('Processing UnsubscribeRequest', 'MCP');
      const requestData = prepareRequest(
        {
          method: 'resources/unsubscribe',
          uri: request.params.uri,
        },
        request
      );
      const response = await wpRequest(requestData, transportType === 'jsonrpc');
      return response;
    })
  );

  // List Prompts Handler
  server.setRequestHandler(
    ListPromptsRequestSchema,
    withLogging('ListPrompts', async (request: ListPromptsRequest) => {
      logger.debug('Processing ListPromptsRequest', 'MCP');
      const requestData = prepareRequest(
        {
          method: 'prompts/list',
          cursor: request.params?.cursor,
        },
        request
      );
      const response = await wpRequest(requestData, transportType === 'jsonrpc');
      return response;
    })
  );

  // Get Prompt Handler
  server.setRequestHandler(
    GetPromptRequestSchema,
    withLogging('GetPrompt', async (request: GetPromptRequest) => {
      logger.debug('Processing GetPromptRequest', 'MCP');
      const requestData = prepareRequest(
        {
          method: 'prompts/get',
          name: request.params.name,
          arguments: request.params.arguments,
        },
        request
      );
      const response = await wpRequest(requestData, transportType === 'jsonrpc');
      return response;
    })
  );

  // Set Logging Level Handler
  server.setRequestHandler(
    SetLevelRequestSchema,
    withLogging('SetLevel', async (request: SetLevelRequest) => {
      logger.debug('Processing SetLevelRequest', 'MCP');
      const requestData = prepareRequest(
        {
          method: 'logging/setLevel',
          level: request.params.level,
        },
        request
      );
      const response = await wpRequest(requestData, transportType === 'jsonrpc');
      return response;
    })
  );

  // Complete Handler
  server.setRequestHandler(
    CompleteRequestSchema,
    withLogging('Complete', async (request: CompleteRequest) => {
      logger.debug('Processing CompleteRequest', 'MCP');
      const requestData = prepareRequest(
        {
          method: 'completion/complete',
          ref: request.params.ref,
          argument: request.params.argument,
        },
        request
      );
      const response = await wpRequest(requestData, transportType === 'jsonrpc');
      return response;
    })
  );

  // List Roots Handler
  server.setRequestHandler(
    ListRootsRequestSchema,
    withLogging('ListRoots', async (request: ListRootsRequest) => {
      logger.debug('Processing ListRootsRequest', 'MCP');
      const requestData = prepareRequest(
        {
          method: 'roots/list',
        },
        request
      );
      const response = await wpRequest(requestData, transportType === 'jsonrpc');
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
