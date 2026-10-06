import { randomUUID } from 'node:crypto';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage, JSONRPCRequest, McpError } from '@modelcontextprotocol/sdk/types.js';
import { MCP_WORDPRESS_REMOTE_VERSION } from './config.js';
import { APIError } from './oauth-types.js';
import { apiErrorToMcpError, describeConnectionError } from './error-utils.js';
import { runToolCallHooks } from './tool-call-hooks.js';
import { bindWordPressRequest, setWordPressSession } from './wordpress-api.js';
import { PROTOCOL_VERSION_META } from './wordpress-transport.js';
import { WordPressRequestParams, WordPressResponse } from './types.js';
import { logger } from './utils.js';

type Pending = {
  request: JSONRPCRequest;
  resolve?: (result: WordPressResponse) => void;
  reject?: (error: Error) => void;
};

const asRequest = (message: JSONRPCMessage | undefined): JSONRPCRequest | undefined =>
  message && 'method' in message && 'id' in message ? message : undefined;

/**
 * Forward messages; only observe initialization and correlate optional hook requests.
 * Request deadlines are owned by the WordPress transport, which reports them via `fail`.
 */
export async function startPassThrough(local: Transport, remote: StreamableHTTPClientTransport) {
  const pending = new Map<string | number, Pending>();
  let initializeId: string | number | undefined;
  let init: Promise<void> | undefined;
  let settleInit: (() => void) | undefined;
  let initError: Error | undefined;
  let closed = false;

  const output = (message: JSONRPCMessage) => {
    void local
      .send(message)
      .catch(error => logger.error('Cannot write client response', 'PROXY', error));
  };
  const outputError = (id: string | number, error: McpError) => {
    output({
      jsonrpc: '2.0',
      id,
      error: { code: error.code, message: error.message, data: error.data },
    });
  };
  const finish = (id: string | number) => {
    const entry = pending.get(id);
    pending.delete(id);
    return entry;
  };
  const fail = (failed: JSONRPCMessage | undefined, error: Error) => {
    const message = asRequest(failed);
    if (!message) {
      logger.error('WordPress transport error', 'PROXY', error);
      return;
    }
    const entry = finish(message.id);
    if (!entry) return;
    if (message.method === 'initialize') {
      initError = error;
      if (entry.reject) {
        entry.reject(error);
        settleInit?.();
        return;
      }
      const info = describeConnectionError(error);
      // Preserve the existing degraded handshake, using the client's own offered version.
      const version = message.params?.protocolVersion;
      if (typeof version === 'string') {
        output({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: version,
            serverInfo: {
              name: 'WordPress MCP Remote Proxy',
              version: MCP_WORDPRESS_REMOTE_VERSION,
            },
            capabilities: {
              experimental: { connectionFailed: info.code ? { code: info.code } : {} },
            },
            instructions: `MCP WordPress Remote Proxy Server (Connection Failed${info.code ? `: ${info.code}` : ''})`,
          },
        });
        settleInit?.();
        return;
      }
    }
    if (entry.reject) {
      entry.reject(error);
      return;
    }
    const parts =
      error instanceof APIError ? apiErrorToMcpError(error) : new McpError(-32603, error.message);
    outputError(message.id, new McpError(parts.code, error.message, parts.data));
    if (message.id === initializeId) settleInit?.();
  };

  async function send(message: JSONRPCMessage, callbacks?: Pick<Pending, 'resolve' | 'reject'>) {
    const request = asRequest(message);
    if (request?.method === 'initialize') {
      initializeId = request.id;
      initError = undefined;
      init = new Promise<void>(resolve => {
        settleInit = resolve;
      });
    } else if (
      'method' in message &&
      // 2026 stateless requests carry their version and never wait on a legacy initialize.
      typeof message.params?._meta?.[PROTOCOL_VERSION_META] !== 'string'
    ) {
      await init;
      if (initError) {
        if (request) {
          const info = describeConnectionError(initError);
          const error = new McpError(
            -32603,
            `Cannot process ${request.method}: WordPress connection failed during initialization`,
            { reason: 'failed', ...info }
          );
          if (callbacks?.reject) callbacks.reject(error);
          else outputError(request.id, error);
        }
        return;
      }
    }
    if (closed) {
      callbacks?.reject?.(new Error('WordPress connection closed'));
      return;
    }
    if (request) pending.set(request.id, { request, ...callbacks });
    try {
      logger.debug(
        `Forwarding client message: ${'method' in message ? message.method : 'response'}`,
        'PROXY'
      );
      await remote.send(message);
    } catch (error) {
      fail(message, error instanceof Error ? error : new Error(String(error)));
    }
  }

  const hookRequest = (params: WordPressRequestParams): Promise<WordPressResponse> => {
    const { method, ...arguments_ } = params;
    return new Promise((resolve, reject) => {
      void send(
        { jsonrpc: '2.0', id: randomUUID(), method, params: arguments_ },
        { resolve, reject }
      ).catch(reject);
    });
  };
  const unbindRequest = bindWordPressRequest(hookRequest);
  remote.onmessage = message => {
    const entry =
      !('method' in message) && 'id' in message && message.id !== undefined
        ? finish(message.id)
        : undefined;
    if (entry?.request.method === 'initialize') {
      if ('result' in message && typeof message.result.protocolVersion === 'string') {
        remote.setProtocolVersion(message.result.protocolVersion);
        setWordPressSession(remote.sessionId, message.result.protocolVersion);
      } else if ('error' in message) initError = new Error(message.error.message);
      logger.debug('Upstream initialization settled', 'PROXY');
      settleInit?.();
    }
    if (entry?.resolve) {
      if ('result' in message) entry.resolve(message.result);
      else if ('error' in message)
        entry.reject?.(new McpError(message.error.code, message.error.message, message.error.data));
      return;
    }
    output(message);
    if (entry?.request.method === 'tools/call' && 'result' in message) {
      runToolCallHooks({ name: String(entry.request.params?.name ?? ''), wpRequest: hookRequest });
    }
  };
  remote.onerror = error => logger.error('WordPress transport error', 'PROXY', error);
  local.onerror = error => logger.error('Client transport error', 'PROXY', error);
  local.onmessage = message => {
    void send(message).catch(error => fail(message, error));
  };
  const close = async () => {
    if (closed) return;
    closed = true;
    unbindRequest();
    settleInit?.();
    for (const entry of pending.values()) {
      entry.reject?.(new Error('WordPress connection closed'));
    }
    pending.clear();
    await Promise.all([remote.close(), local.close()]);
  };
  local.onclose = () => {
    void close();
  };
  await remote.start();
  await local.start();
  return { close, fail };
}
