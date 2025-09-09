/**
 * Error handling utilities for MCP WordPress Remote
 * 
 * Provides functions for converting API errors to MCP-compliant error formats
 */

import { APIError } from './oauth-types.js';

/**
 * Maps HTTP status codes to MCP JSON-RPC error codes
 * Based on the MCP error codes from RestTransport.php
 */
export function mapHttpStatusToMcpCode(statusCode: number): number {
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
