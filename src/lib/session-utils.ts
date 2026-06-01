/**
 * Session and Request Utilities for MCP WordPress Remote
 *
 * Provides utilities for session management and request preparation
 */

import { logger } from './utils.js';
import { WPRequestParams, MCPRequest, TransportType } from './mcp-types.js';
import { ConnectionErrorInfo } from './error-utils.js';

/**
 * Session context for the proxy
 */
export interface SessionContext {
  sessionId: string | null;
  requestIdCounter: number;
  transportType: TransportType;
  /** @internal Managed by resolveInit/waitForInit — do not access directly. */
  _init: {
    ready: Promise<void>;
    resolve: () => void;
    settled: boolean;
    failed: boolean;
    /** Details of the failure when `failed` is true; surfaced to the client. */
    error?: ConnectionErrorInfo;
  };
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
  let resolve: () => void;
  const ready = new Promise<void>(r => { resolve = r; });

  return {
    sessionId: null,
    requestIdCounter: 0,
    transportType: null,
    _init: {
      ready,
      resolve: resolve!,
      settled: false,
      failed: false,
    },
  };
}

/**
 * Signal that initialization completed (success or failure).
 * Unblocks all handlers waiting on waitForInit.
 *
 * @param context - The session context.
 * @param failed  - Whether initialization failed.
 * @param error   - Failure details to surface to the client (only when failed).
 */
export function resolveInit(
  context: SessionContext,
  failed: boolean,
  error?: ConnectionErrorInfo
): void {
  if (context._init.settled) return;
  context._init.failed = failed;
  context._init.error = failed ? error : undefined;
  context._init.settled = true;
  context._init.resolve();
}

/** Default timeout for waiting on init (30s matches the MCP SDK's default request timeout). */
const INIT_TIMEOUT_MS = 30_000;

/**
 * Wait for initialization to complete before handling a request.
 * Returns true if the connection is ready, false if init failed or timed out.
 */
export type InitResult =
  | { ready: true }
  | { ready: false; reason: 'failed' | 'timeout'; error?: ConnectionErrorInfo };

export async function waitForInit(context: SessionContext, timeoutMs = INIT_TIMEOUT_MS): Promise<InitResult> {
  // Fast path: init already settled, no async work needed
  if (context._init.settled) {
    return context._init.failed
      ? { ready: false, reason: 'failed', error: context._init.error }
      : { ready: true };
  }

  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });

  const result = await Promise.race([context._init.ready.then(() => 'ready' as const), timeout]);
  clearTimeout(timer!);

  if (result === 'timeout') {
    logger.error('Timed out waiting for initialization to complete', 'INIT');
    return { ready: false, reason: 'timeout' };
  }

  return context._init.failed
    ? { ready: false, reason: 'failed', error: context._init.error }
    : { ready: true };
}
