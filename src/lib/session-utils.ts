/**
 * Session and Request Utilities for MCP WordPress Remote
 * 
 * Provides utilities for session management and request preparation
 */

import { logger } from './utils.js';
import { WPRequestParams, MCPRequest, TransportType } from './mcp-types.js';

/**
 * Session context for the proxy
 */
export interface SessionContext {
  sessionId: string | null;
  requestIdCounter: number;
  transportType: TransportType;
}

/**
 * Add session information to WordPress requests and format as JSON-RPC
 */
export function addSessionInfo(
  wpRequestParams: WPRequestParams, 
  mcpRequest: MCPRequest,
  context: SessionContext
) {
  // Increment the request ID counter for each new request
  context.requestIdCounter++;

  // Create proper MCP JSON-RPC format
  const { method, ...params } = wpRequestParams;
  const mcpMessage = {
    jsonrpc: '2.0',
    method: method,
    id: mcpRequest.id || context.requestIdCounter, // Use original MCP request ID
    params: {
      ...params,
      // Add internal tracking for WordPress
      _proxy_request_id: context.requestIdCounter,
    },
  };

  logger.debug(`MCP JSON-RPC message being sent to WordPress:`, 'SESSION', {
    jsonrpc: mcpMessage.jsonrpc,
    method: mcpMessage.method,
    id: mcpMessage.id,
    original_mcp_id: mcpRequest.id || 'none',
    session_id: context.sessionId || 'not-yet-obtained',
  });

  return mcpMessage;
}

/**
 * Prepare request based on transport type
 */
export function prepareRequest(
  wpRequestParams: WPRequestParams, 
  mcpRequest: MCPRequest,
  context: SessionContext
) {
  if (context.transportType === 'jsonrpc') {
    // Use full JSON-RPC format
    return addSessionInfo(wpRequestParams, mcpRequest, context);
  } else {
    // Use simple format (just the params)
    return wpRequestParams;
  }
}

/**
 * Create a new session context
 */
export function createSessionContext(): SessionContext {
  return {
    sessionId: null,
    requestIdCounter: 0,
    transportType: null,
  };
}
