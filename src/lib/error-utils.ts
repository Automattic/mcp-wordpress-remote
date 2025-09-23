/**
 * Error handling utilities for MCP WordPress Remote
 * 
 * Provides functions for converting API errors to MCP-compliant error formats
 */

import { APIError } from './oauth-types.js';

/**
 * Maps HTTP status codes to MCP JSON-RPC error codes
 * Based on JSON-RPC 2.0 specification and MCP best practices
 */
export function mapHttpStatusToMcpCode(statusCode: number): number {
  // JSON-RPC 2.0 standard error codes
  const JSONRPC_ERROR_CODES = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,
  };

  // MCP-specific error codes (in -32000 to -32099 range, using only well-established codes)
  const MCP_ERROR_CODES = {
    SERVER_ERROR: -32000,       // Generic server error
    TIMEOUT_ERROR: -32001,      // Request timeout
    RESOURCE_NOT_FOUND: -32002, // Resource not found
    TOOL_NOT_FOUND: -32003,     // Tool not found  
    PROMPT_NOT_FOUND: -32004,   // Prompt not found
    PERMISSION_DENIED: -32008,  // Access denied/forbidden
    UNAUTHORIZED: -32010,       // Authentication required
  };

  switch (statusCode) {
    case 400: // Bad Request
      return JSONRPC_ERROR_CODES.INVALID_REQUEST;
    case 401: // Unauthorized
      return MCP_ERROR_CODES.UNAUTHORIZED;
    case 403: // Forbidden
      return MCP_ERROR_CODES.PERMISSION_DENIED;
    case 404: // Not Found
      return JSONRPC_ERROR_CODES.METHOD_NOT_FOUND;
    case 408: // Request Timeout
      return MCP_ERROR_CODES.TIMEOUT_ERROR;
    case 413: // Payload Too Large
    case 422: // Unprocessable Entity
      return JSONRPC_ERROR_CODES.INVALID_PARAMS;
    case 500: // Internal Server Error
      return JSONRPC_ERROR_CODES.INTERNAL_ERROR;
    case 502: // Bad Gateway
    case 503: // Service Unavailable
      return MCP_ERROR_CODES.SERVER_ERROR;
    case 504: // Gateway Timeout
      return MCP_ERROR_CODES.TIMEOUT_ERROR;
    default:
      // For unknown status codes, use internal error
      return JSONRPC_ERROR_CODES.INTERNAL_ERROR;
  }
}

/**
 * Converts an APIError to MCP error response format
 */
export function convertAPIErrorToMcpError(error: APIError) {
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
