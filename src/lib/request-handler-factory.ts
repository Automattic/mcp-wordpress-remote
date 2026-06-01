/**
 * Request Handler Factory for MCP WordPress Remote
 * 
 * Creates standardized request handlers to eliminate repetitive code
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { logger } from './utils.js';
import { wpRequest } from './wordpress-api.js';
import { isAPIError } from './oauth-types.js';
import { convertAPIErrorToMcpError, apiErrorToMcpError } from './error-utils.js';
import { prepareRequest, waitForInit, SessionContext } from './session-utils.js';
import { WPRequestParams } from './mcp-types.js';

/**
 * Configuration for creating a request handler
 */
export interface HandlerConfig {
  name: string;
  method: string;
  paramMapper: (request: any) => WPRequestParams;
}

/**
 * Create a standardized MCP request handler
 */
export function createRequestHandler(config: HandlerConfig, context: SessionContext) {
  return async (request: any) => {
    logger.debug(`Processing ${config.name}Request`, 'MCP');

    // Wait for transport detection to complete before forwarding any requests
    const init = await waitForInit(context);
    if (!init.ready) {
      const cause = init.reason === 'timeout' ? 'timed out waiting for' : 'failed during';
      const message = `Cannot process ${config.method}: WordPress connection ${cause} initialization`;
      // Surface the underlying cause in the JSON-RPC error `data` so the client
      // can show why initialization failed (TLS, DNS, refused) instead of a
      // bare internal error.
      const data: Record<string, unknown> = { reason: init.reason };
      if (init.reason === 'failed' && init.error) {
        data.code = init.error.code;
        data.detail = init.error.message;
        if (init.error.hint) {
          data.hint = init.error.hint;
        }
      }
      throw new McpError(ErrorCode.InternalError, message, data);
    }

    // Map request parameters to WordPress format
    const wpParams = config.paramMapper(request);

    // Prepare request based on transport type
    const requestData = prepareRequest(wpParams, request, context);

    // Send request to WordPress
    const response = await wpRequest(requestData, context.transportType === 'jsonrpc');

    return response;
  };
}

/**
 * Create a request handler with logging and error handling wrapper
 */
export function createWrappedHandler(config: HandlerConfig, context: SessionContext) {
  const handler = createRequestHandler(config, context);
  
  return async (request: any) => {
    // Enhanced client message logging
    logger.info(`📩 Client Message: ${config.name}`, 'CLIENT');
    logger.info(`Request ID: ${request.id || 'none'} | Method: ${config.method}`, 'CLIENT');
    
    // Log request parameters in a structured way
    if (request.params && Object.keys(request.params).length > 0) {
      logger.info(`Request parameters:`, 'CLIENT', {
        paramCount: Object.keys(request.params).length,
        paramKeys: Object.keys(request.params),
      });
      logger.debug(`Full request parameters:`, 'CLIENT', request.params);
    } else {
      logger.info(`No request parameters`, 'CLIENT');
    }
    
    // Log session context
    logger.debug(
      `Session context - ID: ${context.sessionId || 'none'}, Transport: ${context.transportType || 'detecting'}, Counter: ${context.requestIdCounter}`,
      'CLIENT'
    );
    
    // Log full request object at debug level for detailed debugging
    logger.debug(`Complete client request object:`, 'CLIENT', request);
    
    const startTime = Date.now();
    
    try {
      const response = await handler(request);
      const duration = Date.now() - startTime;
      
      logger.info(`✅ Client Response: ${config.name} completed in ${duration}ms`, 'CLIENT');
      logger.debug(`Response sent to client:`, 'CLIENT', {
        hasResponse: !!response,
        responseKeys: response && typeof response === 'object' ? Object.keys(response) : 'primitive',
      });
      
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error(`❌ Client Error: ${config.name} failed after ${duration}ms`, 'CLIENT', {
        error: error instanceof Error ? error.message : String(error),
        requestId: request.id,
      });
      
      if (isAPIError(error)) {
        // Simple transport returns errors as a tool result.
        if (context.transportType === 'simple') {
          logger.debug(`Converting APIError to MCP error format for ${config.name} (simple transport)`, 'MCP', {
            statusCode: error.statusCode,
            endpoint: error.endpoint,
            message: error.message,
          });
          return convertAPIErrorToMcpError(error);
        }

        // JSON-RPC transport: throw a faithful McpError. apiErrorToMcpError
        // forwards a WordPress JSON-RPC error's original code/data, maps
        // HTTP-status errors, and surfaces below-HTTP failures with code + hint.
        // Throwing a plain Error here would let the SDK flatten everything to
        // -32603 and drop WordPress's real error code.
        logger.debug(`Converting APIError to McpError for ${config.name} (jsonrpc transport)`, 'MCP', {
          statusCode: error.statusCode,
          code: error.code,
          endpoint: error.endpoint,
          message: error.message,
        });
        throw apiErrorToMcpError(error);
      }

      // Non-API errors: re-throw (MCP SDK will handle).
      throw error;
    }
  };
}

/**
 * Predefined handler configurations for all MCP methods
 */
export const HANDLER_CONFIGS: Record<string, HandlerConfig> = {
  listTools: {
    name: 'ListTools',
    method: 'tools/list',
    paramMapper: (request) => ({
      method: 'tools/list',
      cursor: request.params?.cursor,
    }),
  },
  
  callTool: {
    name: 'CallTool', 
    method: 'tools/call',
    paramMapper: (request) => ({
      method: 'tools/call',
      name: request.params.name,
      arguments: request.params.arguments,
    }),
  },
  
  listResources: {
    name: 'ListResources',
    method: 'resources/list',
    paramMapper: (request) => ({
      method: 'resources/list',
      cursor: request.params?.cursor,
    }),
  },
  
  listResourceTemplates: {
    name: 'ListResourceTemplates',
    method: 'resources/templates/list',
    paramMapper: (request) => ({
      method: 'resources/templates/list',
      cursor: request.params?.cursor,
    }),
  },
  
  readResource: {
    name: 'ReadResource',
    method: 'resources/read',
    paramMapper: (request) => ({
      method: 'resources/read',
      uri: request.params.uri,
    }),
  },
  
  subscribe: {
    name: 'Subscribe',
    method: 'resources/subscribe',
    paramMapper: (request) => ({
      method: 'resources/subscribe',
      uri: request.params.uri,
    }),
  },
  
  unsubscribe: {
    name: 'Unsubscribe',
    method: 'resources/unsubscribe',
    paramMapper: (request) => ({
      method: 'resources/unsubscribe',
      uri: request.params.uri,
    }),
  },
  
  listPrompts: {
    name: 'ListPrompts',
    method: 'prompts/list',
    paramMapper: (request) => ({
      method: 'prompts/list',
      cursor: request.params?.cursor,
    }),
  },
  
  getPrompt: {
    name: 'GetPrompt',
    method: 'prompts/get',
    paramMapper: (request) => ({
      method: 'prompts/get',
      name: request.params.name,
      arguments: request.params.arguments,
    }),
  },
  
  setLevel: {
    name: 'SetLevel',
    method: 'logging/setLevel',
    paramMapper: (request) => ({
      method: 'logging/setLevel',
      level: request.params.level,
    }),
  },
  
  complete: {
    name: 'Complete',
    method: 'completion/complete',
    paramMapper: (request) => ({
      method: 'completion/complete',
      ref: request.params.ref,
      argument: request.params.argument,
    }),
  },
  
  listRoots: {
    name: 'ListRoots',
    method: 'roots/list',
    paramMapper: (request) => ({
      method: 'roots/list',
    }),
  },
};
