/**
 * Request Handler Factory for MCP WordPress Remote
 * 
 * Creates standardized request handlers to eliminate repetitive code
 */

import { logger } from './utils.js';
import { wpRequest } from './wordpress-api.js';
import { isAPIError } from './oauth-types.js';
import { convertAPIErrorToMcpError } from './error-utils.js';
import { prepareRequest, SessionContext } from './session-utils.js';
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
    logger.debug(`Received ${config.name} request`, 'MCP', request);
    logger.debug(
      `Adding session info - Session ID: ${context.sessionId}, MCP Request ID: ${request.id}`,
      'SESSION'
    );
    
    try {
      const response = await handler(request);
      logger.debug(`${config.name} response sent`, 'MCP');
      return response;
    } catch (error) {
      logger.error(`Error handling ${config.name} request`, 'MCP', error);
      
      // Only convert APIError to MCP error format for simple transport
      // JSON-RPC transport already returns properly formatted JSON-RPC errors
      if (isAPIError(error) && context.transportType === 'simple') {
        logger.debug(`Converting APIError to MCP error format for ${config.name} (simple transport)`, 'MCP', {
          statusCode: error.statusCode,
          endpoint: error.endpoint,
          message: error.message,
        });
        return convertAPIErrorToMcpError(error);
      }
      
      // For JSON-RPC transport or non-API errors, re-throw (MCP SDK will handle)
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
