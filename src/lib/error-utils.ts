/**
 * Error handling utilities for MCP WordPress Remote
 * 
 * Provides functions for converting API errors to MCP-compliant error formats
 */

import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { APIError } from './oauth-types.js';

/** MCP JSON-RPC error code for a request timeout (per mapHttpStatusToMcpCode). */
const MCP_TIMEOUT_ERROR_CODE = -32001;

/**
 * Structured description of a connection-level failure (TLS, DNS, refused, etc.).
 * Used to surface the underlying cause to logs and to the MCP client instead of
 * swallowing it behind a generic "connection failed" message.
 */
export interface ConnectionErrorInfo {
  /** The underlying Node error code, e.g. "UNABLE_TO_VERIFY_LEAF_SIGNATURE". */
  code?: string;
  /** Human-readable error message. */
  message: string;
  /** Actionable hint for resolving the failure, when the code is recognized. */
  hint?: string;
}

/**
 * Node/OpenSSL error codes that mean "the certificate chain is valid but its
 * root is not in Node's trust store" — the mkcert / DDEV / corporate-CA case.
 */
const CA_TRUST_ERROR_CODES = new Set([
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_UNTRUSTED',
]);

const CA_TRUST_HINT =
  'The server certificate was not trusted by Node.js. If the site uses a ' +
  'locally-trusted or corporate CA (mkcert, DDEV, Laravel Valet, a VPN), make ' +
  'Node trust it: set NODE_EXTRA_CA_CERTS to the CA file (e.g. the output of ' +
  '`mkcert -CAROOT` plus rootCA.pem), or on Node 22.15+ set NODE_USE_SYSTEM_CA=1 ' +
  'to trust the OS certificate store. As an insecure last resort, ' +
  'NODE_TLS_REJECT_UNAUTHORIZED=0 disables verification entirely.';

/**
 * Network error codes that mean "the request did not complete in time". A
 * stalled upstream can surface any of these: our own AbortSignal.timeout
 * normalizes to ETIMEDOUT, while undici's own connect/headers deadlines fire
 * first with their own codes.
 */
const TIMEOUT_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
]);

/**
 * Whether a network error code represents a timeout. Used to decide that a
 * failure is terminal (no transport fallback) and to map it to the MCP
 * timeout error code.
 */
export function isTimeoutCode(code?: string): boolean {
  return code != null && TIMEOUT_ERROR_CODES.has(code);
}

/**
 * Walk the `cause` chain of an error and return the first string `code` found.
 *
 * Node's `fetch` (undici) wraps the real network/TLS error as a `TypeError`
 * with the actual error in `.cause`, so the useful code is rarely on the
 * top-level error.
 */
export function extractNetworkErrorCode(error: unknown): string | undefined {
  let current: any = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current.code === 'string') {
      return current.code;
    }
    current = current.cause;
  }
  return undefined;
}

/**
 * Walk the `cause` chain and return the deepest (most specific) error message.
 *
 * undici reports TLS/network failures as a top-level `TypeError: fetch failed`
 * whose `cause` carries the real detail (e.g. "unable to verify the first
 * certificate"). Preferring the leaf keeps that detail instead of collapsing
 * to the generic wrapper text.
 */
export function extractNetworkErrorMessage(error: unknown): string {
  let current: any = error;
  let message = error instanceof Error ? error.message : String(error);
  for (let depth = 0; current && depth < 5; depth++) {
    if (current instanceof Error && current.message) {
      message = current.message;
    }
    current = current.cause;
  }
  return message;
}

/**
 * Return an actionable hint for a known connection error code, or undefined.
 */
export function getConnectionErrorHint(code?: string): string | undefined {
  if (!code) {
    return undefined;
  }

  if (CA_TRUST_ERROR_CODES.has(code)) {
    return CA_TRUST_HINT;
  }

  if (isTimeoutCode(code)) {
    return 'The connection timed out. Check network, firewall, or proxy settings, or raise WP_API_TIMEOUT_MS / WP_API_INIT_TIMEOUT_MS.';
  }

  switch (code) {
    case 'CERT_HAS_EXPIRED':
      return 'The server certificate has expired. Renew it on the WordPress host.';
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return 'The server certificate does not match the hostname in WP_API_URL. Check for a host/SAN mismatch.';
    case 'ECONNREFUSED':
      return 'The connection was refused. Check that WP_API_URL points to a running server and the right port.';
    case 'ENOTFOUND':
      return 'The host could not be resolved (DNS). Check WP_API_URL for typos.';
    default:
      return undefined;
  }
}

/**
 * Describe a connection-level error: its code, message, and an actionable hint.
 */
export function describeConnectionError(error: unknown): ConnectionErrorInfo {
  const code = extractNetworkErrorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  return { code, message, hint: getConnectionErrorHint(code) };
}

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
 * Pick the MCP error code for an APIError. Timeout-class network failures
 * (statusCode 0 with a timeout code) map to the timeout code rather than the
 * generic internal error that statusCode 0 would otherwise produce.
 */
function deriveMcpErrorCode(error: APIError): number {
  if (isTimeoutCode(error.code)) {
    return MCP_TIMEOUT_ERROR_CODE;
  }
  return mapHttpStatusToMcpCode(error.statusCode);
}

/**
 * Build the `data` payload for an APIError, including the underlying network
 * code and an actionable hint when available, so the client can tell a timeout
 * or TLS failure apart from a generic internal error.
 */
function buildApiErrorData(error: APIError): Record<string, unknown> {
  const data: Record<string, unknown> = {
    statusCode: error.statusCode,
    endpoint: error.endpoint,
    response: error.response,
  };
  if (error.code) {
    data.code = error.code;
  }
  const hint = getConnectionErrorHint(error.code);
  if (hint) {
    data.hint = hint;
  }
  return data;
}

/**
 * The original WordPress JSON-RPC error, if this APIError wraps one.
 *
 * When WordPress returns a JSON-RPC error envelope, wpRequest stores that
 * `{ code, message, data }` object as the APIError's `response`. We forward it
 * verbatim so the proxy is transparent — the client sees WordPress's own error
 * code, not a flattened internal error.
 */
function forwardedJsonRpcError(
  error: APIError
): { code: number; message?: string; data?: unknown } | null {
  const response = error.response;
  if (response && typeof response === 'object' && typeof (response as any).code === 'number') {
    return response as { code: number; message?: string; data?: unknown };
  }
  return null;
}

/**
 * Derive the MCP error code, message, and data for an APIError, covering all
 * three failure sources:
 *   - a WordPress JSON-RPC error  -> forward its original code, message, data
 *   - an HTTP-status error        -> map the status, attach status/endpoint/body
 *   - a below-HTTP failure (code 0: timeout/DNS/refused/TLS) -> map + code + hint
 */
function mcpErrorParts(error: APIError): { code: number; message: string; data?: unknown } {
  const wpError = forwardedJsonRpcError(error);
  if (wpError) {
    return { code: wpError.code, message: wpError.message ?? error.message, data: wpError.data };
  }
  return { code: deriveMcpErrorCode(error), message: error.message, data: buildApiErrorData(error) };
}

/**
 * Converts an APIError to MCP error response format (used as a tool result on
 * the simple transport, where errors are returned rather than thrown).
 */
export function convertAPIErrorToMcpError(error: APIError) {
  return { error: mcpErrorParts(error) };
}

/**
 * Convert an APIError into a thrown McpError. Forwards a WordPress JSON-RPC
 * error's original code/data, maps HTTP-status errors to a sensible MCP code,
 * and surfaces below-HTTP failures (timeout, DNS, refused, TLS) with their code
 * and hint — so a JSON-RPC client always sees the real cause, never a bare
 * internal error.
 */
export function apiErrorToMcpError(error: APIError): McpError {
  const { code, message, data } = mcpErrorParts(error);
  return new McpError(code, message, data);
}
