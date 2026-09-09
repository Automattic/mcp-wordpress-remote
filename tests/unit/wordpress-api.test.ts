/**
 * Unit tests for wordpress-api module
 *
 * Tests the wpRequest function: URL construction, authentication dispatch,
 * request formatting, and error handling.
 */

import { jest } from '@jest/globals';
import nock from 'nock';
import { mockEnv } from '../utils/test-helpers.js';

// Mock the OAuth provider to avoid ESM issues with 'open' module
jest.unstable_mockModule('../../src/lib/mcp-oauth-provider.js', () => ({
  MCPOAuthProvider: jest.fn().mockImplementation(() => ({
    authorize: jest.fn().mockImplementation(() => Promise.resolve()),
    tokens: jest.fn().mockImplementation(() => Promise.resolve(null)),
  })),
}));

// Mock persistent OAuth client provider
jest.unstable_mockModule('../../src/lib/persistent-oauth-client-provider.js', () => ({
  PersistentWPOAuthClientProvider: jest.fn().mockImplementation(() => ({})),
}));

// Mock coordination module
jest.unstable_mockModule('../../src/lib/coordination.js', () => ({
  createLazyWPAuthCoordinator: jest.fn().mockReturnValue({
    waitForAuth: jest.fn().mockImplementation(() => Promise.resolve(null)),
  }),
}));

// The WordPress MCP endpoint used by the source code
const WP_MCP_ENDPOINT = '/?rest_route=/wp/v2/wpmcp';

function createJsonRpcResult(id: number, result: any) {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

function createJsonRpcError(id: number, code: number, message: string) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
    },
  };
}

describe('WordPress API Module', () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    jest.resetModules();
    nock.cleanAll();
  });

  afterEach(() => {
    if (restoreEnv) {
      restoreEnv();
    }
    nock.cleanAll();
  });

  describe('wpRequest function', () => {
    describe('Environment validation', () => {
      it('should throw AuthError when configuration validation fails', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: '', // Invalid empty URL
        });

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');

        await expect(wpRequest({ method: 'initialize' })).rejects.toThrow(
          'Configuration validation failed'
        );
      });

      it('should proceed when configuration is valid', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://test-site.com',
          JWT_TOKEN: 'test-jwt-token',
        });

        nock('https://test-site.com')
          .post(WP_MCP_ENDPOINT)
          .reply(200, { status: 'success', data: 'test' });

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');

        const response = await wpRequest({ method: 'initialize' });
        expect(response).toEqual({ status: 'success', data: 'test' });
      });
    });

    describe('URL construction', () => {
      it('should use REST route format for standard WordPress sites', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://my-wp-site.com',
          JWT_TOKEN: 'test-jwt-token',
        });

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT)
          .reply(200, { status: 'success' });

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        await wpRequest({ method: 'initialize' });

        expect(nock.isDone()).toBe(true);
      });

      it('should use exact URL when custom path is provided', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://my-wp-site.com/custom/path',
          JWT_TOKEN: 'test-jwt-token',
        });

        nock('https://my-wp-site.com')
          .post('/custom/path')
          .reply(200, { status: 'success' });

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        await wpRequest({ method: 'initialize' });

        expect(nock.isDone()).toBe(true);
      });

      it('should remove trailing slashes from URL', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://my-wp-site.com///',
          JWT_TOKEN: 'test-jwt-token',
        });

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT)
          .reply(200, { status: 'success' });

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        await wpRequest({ method: 'initialize' });

        expect(nock.isDone()).toBe(true);
      });
    });

    describe('Authentication methods', () => {
      describe('JWT Token authentication', () => {
        it('should use JWT token when available', async () => {
          restoreEnv = mockEnv({
            WP_API_URL: 'https://my-wp-site.com',
            JWT_TOKEN: 'test-jwt-token-12345',
          });

          nock('https://my-wp-site.com')
            .post(WP_MCP_ENDPOINT)
            .matchHeader('authorization', 'Bearer test-jwt-token-12345')
            .reply(200, { status: 'success' });

          const { wpRequest } = await import('../../src/lib/wordpress-api.js');
          await wpRequest({ method: 'initialize' });

          expect(nock.isDone()).toBe(true);
        });
      });

      describe('Basic Auth authentication', () => {
        it('should use WordPress Basic Auth when JWT is not available', async () => {
          restoreEnv = mockEnv({
            WP_API_URL: 'https://my-wp-site.com',
            WP_API_USERNAME: 'testuser',
            WP_API_PASSWORD: 'testpass',
          });

          const expectedAuth = Buffer.from('testuser:testpass').toString('base64');

          nock('https://my-wp-site.com')
            .post(WP_MCP_ENDPOINT)
            .matchHeader('authorization', `Basic ${expectedAuth}`)
            .reply(200, { status: 'success' });

          const { wpRequest } = await import('../../src/lib/wordpress-api.js');
          await wpRequest({ method: 'initialize' });

          expect(nock.isDone()).toBe(true);
        });

        it('should use WooCommerce credentials for WooCommerce report tools', async () => {
          restoreEnv = mockEnv({
            WP_API_URL: 'https://my-wp-site.com',
            WP_API_USERNAME: 'wp-user',
            WP_API_PASSWORD: 'wp-pass',
            WOO_CUSTOMER_KEY: 'woo_key',
            WOO_CUSTOMER_SECRET: 'woo_secret',
          });

          const expectedAuth = Buffer.from('woo_key:woo_secret').toString('base64');

          nock('https://my-wp-site.com')
            .post(WP_MCP_ENDPOINT)
            .matchHeader('authorization', `Basic ${expectedAuth}`)
            .reply(200, { status: 'success' });

          const { wpRequest } = await import('../../src/lib/wordpress-api.js');
          await wpRequest({
            method: 'tools/call',
            params: { name: 'wc_reports_sales' },
          });

          expect(nock.isDone()).toBe(true);
        });

        it('should throw AuthError when WooCommerce credentials are missing for WooCommerce tools', async () => {
          restoreEnv = mockEnv({
            WP_API_URL: 'https://my-wp-site.com',
            WP_API_USERNAME: 'testuser',
            WP_API_PASSWORD: 'testpass',
            // Missing WOO_CUSTOMER_KEY and WOO_CUSTOMER_SECRET
          });

          const { wpRequest } = await import('../../src/lib/wordpress-api.js');

          await expect(wpRequest({
            method: 'tools/call',
            params: { name: 'wc_reports_sales' },
          })).rejects.toThrow('Missing WooCommerce credentials');
        });
      });

      describe('OAuth authentication', () => {
        it('should attempt OAuth when enabled and no JWT token', async () => {
          restoreEnv = mockEnv({
            WP_API_URL: 'https://my-wp-site.com',
            OAUTH_ENABLED: 'true',
            WP_OAUTH_CLIENT_ID: 'test-client-id',
          });

          const { wpRequest } = await import('../../src/lib/wordpress-api.js');

          // OAuth mock returns null tokens, no Basic Auth fallback either
          await expect(wpRequest({ method: 'initialize' })).rejects.toThrow(
            'No authentication method available'
          );
        });

        it('should fallback to Basic Auth when OAuth fails', async () => {
          restoreEnv = mockEnv({
            WP_API_URL: 'https://my-wp-site.com',
            OAUTH_ENABLED: 'true',
            WP_OAUTH_CLIENT_ID: 'test-client-id',
            WP_API_USERNAME: 'fallback-user',
            WP_API_PASSWORD: 'fallback-pass',
          });

          const expectedAuth = Buffer.from('fallback-user:fallback-pass').toString('base64');

          nock('https://my-wp-site.com')
            .post(WP_MCP_ENDPOINT)
            .matchHeader('authorization', `Basic ${expectedAuth}`)
            .reply(200, { status: 'success' });

          const { wpRequest } = await import('../../src/lib/wordpress-api.js');
          await wpRequest({ method: 'initialize' });

          expect(nock.isDone()).toBe(true);
        });
      });

      describe('No authentication', () => {
        it('should throw AuthError when no authentication method is configured', async () => {
          restoreEnv = mockEnv({
            WP_API_URL: 'https://my-wp-site.com',
            // No authentication methods configured
          });

          const { wpRequest } = await import('../../src/lib/wordpress-api.js');

          await expect(wpRequest({ method: 'initialize' })).rejects.toThrow(
            'No authentication method'
          );
        });
      });
    });

    describe('Request handling', () => {
      it('should send POST request with correct headers', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://my-wp-site.com',
          JWT_TOKEN: 'test-token',
        });

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT)
          .matchHeader('authorization', 'Bearer test-token')
          .matchHeader('content-type', 'application/json')
          .reply(200, { status: 'success' });

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        await wpRequest({ method: 'initialize' });

        expect(nock.isDone()).toBe(true);
      });

      it('should send request body as JSON', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://my-wp-site.com',
          JWT_TOKEN: 'test-token',
        });

        const requestParams = { method: 'tools/list', cursor: 'abc123' };

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT, requestParams)
          .reply(200, { status: 'success' });

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        await wpRequest(requestParams);

        expect(nock.isDone()).toBe(true);
      });

      it('should handle successful API responses', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://my-wp-site.com',
          JWT_TOKEN: 'test-token',
        });

        const expectedResponse = {
          status: 'success',
          data: { tools: ['tool1', 'tool2'] }
        };

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT)
          .reply(200, expectedResponse);

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        const response = await wpRequest({ method: 'tools/list' });

        expect(response).toEqual(expectedResponse);
      });

      it('should parse text/event-stream responses and extract the JSON-RPC result', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://my-wp-site.com',
          JWT_TOKEN: 'test-token',
        });

        const jsonRpcEnvelope = {
          jsonrpc: '2.0',
          id: 1,
          result: {
            protocolVersion: '2025-06-18',
            serverInfo: { name: 'Parker', version: '1.0.0' },
            capabilities: {},
          },
        };
        const sseBody =
          `event: message\n` +
          `id: abc-123\n` +
          `data: ${JSON.stringify(jsonRpcEnvelope)}\n\n`;

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT)
          .reply(200, sseBody, { 'Content-Type': 'text/event-stream' });

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        const response = await wpRequest(
          { jsonrpc: '2.0', method: 'initialize', id: 1, params: {} },
          true
        );

        expect(response).toEqual(jsonRpcEnvelope.result);
      });

      it('should handle multi-line data fields in SSE responses', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://my-wp-site.com',
          JWT_TOKEN: 'test-token',
        });

        const payload = { jsonrpc: '2.0', id: 1, result: { ok: true } };
        const json = JSON.stringify(payload, null, 2);
        const sseBody =
          `event: message\n` +
          json
            .split('\n')
            .map(l => `data: ${l}`)
            .join('\n') +
          `\n\n`;

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT)
          .reply(200, sseBody, { 'Content-Type': 'text/event-stream' });

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        const response = await wpRequest(
          { jsonrpc: '2.0', method: 'initialize', id: 1, params: {} },
          true
        );

        expect(response).toEqual(payload.result);
      });

      it('should treat SSE frames with no event field as default "message" events', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://my-wp-site.com',
          JWT_TOKEN: 'test-token',
        });

        const jsonRpcEnvelope = {
          jsonrpc: '2.0',
          id: 1,
          result: { ok: true },
        };
        // No `event:` field — per the SSE spec this is a default "message" event.
        const sseBody = `data: ${JSON.stringify(jsonRpcEnvelope)}\n\n`;

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT)
          .reply(200, sseBody, { 'Content-Type': 'text/event-stream' });

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        const response = await wpRequest(
          { jsonrpc: '2.0', method: 'initialize', id: 1, params: {} },
          true
        );

        expect(response).toEqual(jsonRpcEnvelope.result);
      });

      it('should throw when SSE response contains no message event', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://my-wp-site.com',
          JWT_TOKEN: 'test-token',
        });

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT)
          .reply(200, ': keep-alive comment\n\n', { 'Content-Type': 'text/event-stream' });

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');

        await expect(
          wpRequest({ jsonrpc: '2.0', method: 'initialize', id: 1, params: {} }, true)
        ).rejects.toThrow('No "message" event');
      });

      it.each([
        ['invalid-params response', -32602],
        ['internal-error wrapper', -32603],
      ])('should refresh the session once for an expired-session %s', async (_label, errorCode) => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://my-wp-site.com',
          JWT_TOKEN: 'test-token',
        });

        const initializeRequest = {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            clientInfo: {
              name: 'test-client',
              version: '1.0.0',
            },
            _proxy_request_id: 1,
          },
        };
        const toolRequest = {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {
            cursor: 'abc123',
          },
        };
        const promptRequest = {
          jsonrpc: '2.0',
          id: 3,
          method: 'prompts/list',
          params: {},
        };

        const initHeaders: Array<string | undefined> = [];
        let initCallCount = 0;

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT, initializeRequest)
          .twice()
          .reply(function () {
            const header = this.req.headers['mcp-session-id'];
            initHeaders.push(Array.isArray(header) ? header[0] : header as string | undefined);
            initCallCount += 1;

            return [
              200,
              createJsonRpcResult(1, { protocolVersion: '2025-06-18' }),
              {
                'Mcp-Session-Id': initCallCount === 1 ? 'session-1' : 'session-2',
              },
            ];
          });

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT, toolRequest)
          .matchHeader('mcp-session-id', 'session-1')
          .reply(200, createJsonRpcError(2, errorCode, 'Invalid or expired session'));

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT, toolRequest)
          .matchHeader('mcp-session-id', 'session-2')
          .reply(200, createJsonRpcResult(2, { tools: [{ name: 'posts-list' }] }));

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT, promptRequest)
          .matchHeader('mcp-session-id', 'session-2')
          .reply(200, createJsonRpcResult(3, { prompts: [] }));

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');

        await wpRequest(initializeRequest, true);
        await expect(wpRequest(toolRequest, true)).resolves.toEqual({
          tools: [{ name: 'posts-list' }],
        });
        await expect(wpRequest(promptRequest, true)).resolves.toEqual({
          prompts: [],
        });

        expect(initHeaders).toEqual([undefined, undefined]);
        expect(nock.isDone()).toBe(true);
      });

      it('should refresh the session for WPCOM session-not-found errors returned as HTTP JSON-RPC responses', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://public-api.wordpress.com/wpcom/v2/mcp/v1',
          JWT_TOKEN: 'test-token',
        });

        const initializeRequest = {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            clientInfo: {
              name: 'test-client',
              version: '1.0.0',
            },
            _proxy_request_id: 1,
          },
        };
        const toolRequest = {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'wpcom-mcp-account',
            arguments: {
              action: 'list',
            },
          },
        };

        const initHeaders: Array<string | undefined> = [];
        let initCallCount = 0;

        nock('https://public-api.wordpress.com')
          .post('/wpcom/v2/mcp/v1', initializeRequest)
          .twice()
          .reply(function () {
            const header = this.req.headers['mcp-session-id'];
            initHeaders.push(Array.isArray(header) ? header[0] : (header as string | undefined));
            initCallCount += 1;

            return [
              200,
              createJsonRpcResult(1, { protocolVersion: '2025-06-18' }),
              {
                'Mcp-Session-Id': initCallCount === 1 ? 'session-1' : 'session-2',
              },
            ];
          });

        nock('https://public-api.wordpress.com')
          .post('/wpcom/v2/mcp/v1', toolRequest)
          .matchHeader('mcp-session-id', 'session-1')
          .reply(
            404,
            createJsonRpcError(2, -32005, 'Session not found: Invalid or expired session')
          );

        nock('https://public-api.wordpress.com')
          .post('/wpcom/v2/mcp/v1', toolRequest)
          .matchHeader('mcp-session-id', 'session-2')
          .reply(200, createJsonRpcResult(2, { content: [], structuredContent: {} }));

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');

        await wpRequest(initializeRequest, true);
        await expect(wpRequest(toolRequest, true)).resolves.toEqual({
          content: [],
          structuredContent: {},
        });

        expect(initHeaders).toEqual([undefined, undefined]);
        expect(nock.isDone()).toBe(true);
      });

      it('should reuse a shared refresh when stale-session errors resolve out of order', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://my-wp-site.com',
          JWT_TOKEN: 'test-token',
        });

        const initializeRequest = {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            clientInfo: {
              name: 'test-client',
              version: '1.0.0',
            },
            _proxy_request_id: 1,
          },
        };
        const toolsRequest = {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {
            cursor: 'first',
          },
        };
        const promptsRequest = {
          jsonrpc: '2.0',
          id: 3,
          method: 'prompts/list',
          params: {},
        };

        let initCallCount = 0;
        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT, initializeRequest)
          .twice()
          .reply(function () {
            const header = this.req.headers['mcp-session-id'];
            expect(header).toBeUndefined();
            initCallCount += 1;

            return [
              200,
              createJsonRpcResult(1, { protocolVersion: '2025-06-18' }),
              {
                'Mcp-Session-Id': initCallCount === 1 ? 'session-1' : 'session-2',
              },
            ];
          });

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT, toolsRequest)
          .matchHeader('mcp-session-id', 'session-1')
          .reply(200, createJsonRpcError(2, -32602, 'Invalid or expired session'));

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT, promptsRequest)
          .matchHeader('mcp-session-id', 'session-1')
          .delay(25)
          .reply(200, createJsonRpcError(3, -32602, 'Invalid or expired session'));

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT, toolsRequest)
          .matchHeader('mcp-session-id', 'session-2')
          .reply(200, createJsonRpcResult(2, { tools: [] }));

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT, promptsRequest)
          .matchHeader('mcp-session-id', 'session-2')
          .reply(200, createJsonRpcResult(3, { prompts: [] }));

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');

        await wpRequest(initializeRequest, true);

        await expect(
          Promise.all([
            wpRequest(toolsRequest, true),
            wpRequest(promptsRequest, true),
          ])
        ).resolves.toEqual([
          { tools: [] },
          { prompts: [] },
        ]);

        expect(nock.isDone()).toBe(true);
      });
    });

    describe('Error handling', () => {
      it('should throw APIError for HTTP error responses', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://my-wp-site.com',
          JWT_TOKEN: 'test-token',
        });

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT)
          .reply(401, 'Unauthorized');

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');

        await expect(wpRequest({ method: 'initialize' })).rejects.toThrow(
          'WordPress API error (401): Unauthorized'
        );
      });

      it('should throw APIError for network errors', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://my-wp-site.com',
          JWT_TOKEN: 'test-token',
        });

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT)
          .replyWithError('Network error');

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');

        await expect(wpRequest({ method: 'initialize' })).rejects.toThrow(
          'Network error'
        );
      });

      it('allows an opt-in hook to recover a response and retry it once', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://my-wp-site.com',
          JWT_TOKEN: 'test-token',
        });

        const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} };
        const recoverableResponse = { isError: true, content: [{ type: 'text', text: 'retry' }] };

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT, request)
          .reply(200, createJsonRpcResult(1, recoverableResponse))
          .post(WP_MCP_ENDPOINT, request)
          .reply(200, createJsonRpcResult(1, { content: [] }));

        const { registerRequestRecoveryHook } = await import(
          '../../src/lib/request-recovery-hooks.js'
        );
        const hook = jest.fn(async ({ response, refreshProxy }: any) => {
          expect(typeof refreshProxy).toBe('function');
          return response?.isError === true;
        });
        const unregister = registerRequestRecoveryHook(hook);

        try {
          const { wpRequest } = await import('../../src/lib/wordpress-api.js');
          await expect(wpRequest(request, true)).resolves.toEqual({ content: [] });
          expect(hook).toHaveBeenCalledTimes(1);
          expect(nock.isDone()).toBe(true);
        } finally {
          unregister();
        }
      });

      it('allows an opt-in hook to recover an APIError and retry it once', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://my-wp-site.com',
          JWT_TOKEN: 'test-token',
        });

        const request = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT, request)
          .reply(503, 'temporarily unavailable')
          .post(WP_MCP_ENDPOINT, request)
          .reply(200, createJsonRpcResult(1, { tools: [] }));

        const { registerRequestRecoveryHook } = await import(
          '../../src/lib/request-recovery-hooks.js'
        );
        const hook = jest.fn(async ({ error, refreshProxy }: any) => {
          expect(typeof refreshProxy).toBe('function');
          return error?.statusCode === 503;
        });
        const unregister = registerRequestRecoveryHook(hook);

        try {
          const { wpRequest } = await import('../../src/lib/wordpress-api.js');
          await expect(wpRequest(request, true)).resolves.toEqual({ tools: [] });
          expect(hook).toHaveBeenCalledTimes(1);
          expect(nock.isDone()).toBe(true);
        } finally {
          unregister();
        }
      });

      it('does not run recovery hooks again for the retry outcome', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://my-wp-site.com',
          JWT_TOKEN: 'test-token',
        });

        const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} };
        const recoverableResponse = { isError: true, content: [{ type: 'text', text: 'retry' }] };

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT, request)
          .twice()
          .reply(200, createJsonRpcResult(1, recoverableResponse));

        const { registerRequestRecoveryHook } = await import(
          '../../src/lib/request-recovery-hooks.js'
        );
        const hook = jest.fn(async () => true);
        const unregister = registerRequestRecoveryHook(hook);

        try {
          const { wpRequest } = await import('../../src/lib/wordpress-api.js');
          await expect(wpRequest(request, true)).resolves.toEqual(recoverableResponse);
          expect(hook).toHaveBeenCalledTimes(1);
          expect(nock.isDone()).toBe(true);
        } finally {
          unregister();
        }
      });

      it.each(['response', 'APIError'])(
        'surfaces a thrown retry failure after recovering a %s without another recovery',
        async firstOutcome => {
          restoreEnv = mockEnv({
            WP_API_URL: 'https://my-wp-site.com',
            JWT_TOKEN: 'test-token',
          });

          const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} };
          const recoverableResponse = { isError: true, content: [{ type: 'text', text: 'retry' }] };
          let requestCount = 0;
          nock('https://my-wp-site.com')
            .persist()
            .post(WP_MCP_ENDPOINT, request)
            .reply(() => {
              requestCount++;
              if (requestCount === 1 && firstOutcome === 'response') {
                return [200, createJsonRpcResult(1, recoverableResponse)];
              }
              return [503, `failure on attempt ${requestCount}`];
            });

          const { registerRequestRecoveryHook } = await import(
            '../../src/lib/request-recovery-hooks.js'
          );
          // Generic embedding policy: both outcomes would qualify if called again.
          const hook = jest.fn(async () => true);
          const unregister = registerRequestRecoveryHook(hook);

          try {
            const { wpRequest } = await import('../../src/lib/wordpress-api.js');
            await expect(wpRequest(request, true)).rejects.toMatchObject({
              statusCode: 503,
              message: expect.stringContaining('failure on attempt 2'),
            });
            expect(requestCount).toBe(2);
            expect(hook).toHaveBeenCalledTimes(1);
          } finally {
            unregister();
          }
        }
      );

      it.each(['response', 'session error'])('does not recover a redirected %s', async outcome => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://my-wp-site.com',
          JWT_TOKEN: 'test-token',
          USE_SYSTEM_PROXY: 'false',
        });
        const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} };
        const denied = { isError: true, content: [{ type: 'text', text: 'retry' }] };
        const response = new Response(
          JSON.stringify(
            outcome === 'response'
              ? createJsonRpcResult(1, denied)
              : createJsonRpcError(1, -32603, 'Invalid or expired session')
          )
        );
        Object.defineProperty(response, 'redirected', { value: true });
        const originalFetch = globalThis.fetch;
        const fetchMock = jest.fn(async () => response);
        globalThis.fetch = fetchMock as typeof fetch;
        const { registerRequestRecoveryHook } = await import(
          '../../src/lib/request-recovery-hooks.js'
        );
        const hook = jest.fn(async () => true);
        const unregister = registerRequestRecoveryHook(hook);
        try {
          const { wpRequest } = await import('../../src/lib/wordpress-api.js');
          const result = wpRequest(request, true);
          if (outcome === 'response') {
            await expect(result).resolves.toEqual(denied);
          } else {
            await expect(result).rejects.toMatchObject({
              redirected: true,
              statusCode: -32603,
            });
          }
          expect(hook).not.toHaveBeenCalled();
          expect(fetchMock).toHaveBeenCalledTimes(1);
        } finally {
          unregister();
          globalThis.fetch = originalFetch;
        }
      });

      it('should time out a slow request and report ETIMEDOUT', async () => {
        // Regression for issue #61: an unbounded fetch let a stalled upstream
        // hang the initialize handshake for ~60s. The request must now abort.
        const timeoutMs = 80;
        const replyDelay = timeoutMs + 50;
        restoreEnv = mockEnv({
          WP_API_URL: 'https://my-wp-site.com',
          JWT_TOKEN: 'test-token',
          WP_API_INIT_TIMEOUT_MS: String(timeoutMs),
        });

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT)
          .delay(replyDelay)
          .reply(200, { status: 'success' });

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        const { isAPIError } = await import('../../src/lib/oauth-types.js');

        const error: any = await wpRequest({ method: 'initialize' }).catch((e: any) => e);
        expect(isAPIError(error)).toBe(true);
        expect(error.code).toBe('ETIMEDOUT');
        expect(error.message).toMatch(/timed out after 80ms/);

        // Let nock's delayed reply timer fire and clear before teardown so it
        // doesn't leak into the worker (the request was already aborted).
        await new Promise(resolve => setTimeout(resolve, replyDelay + 25));
      });

      it('should throw APIError for invalid JSON responses', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://my-wp-site.com',
          JWT_TOKEN: 'test-token',
        });

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT)
          .reply(200, 'invalid json');

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');

        await expect(wpRequest({ method: 'initialize' })).rejects.toThrow();
      });

      it.each([
        ['invalid-params', -32602, 'Cursor is invalid'],
        ['internal', -32603, 'Internal server error'],
        ['internal session-not-found', -32603, 'Session not found'],
      ])(
        'should not refresh the session for an unrelated %s error',
        async (_label, code, message) => {
          restoreEnv = mockEnv({
            WP_API_URL: 'https://my-wp-site.com',
            JWT_TOKEN: 'test-token',
          });

          const initializeRequest = {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              clientInfo: {
                name: 'test-client',
                version: '1.0.0',
              },
              _proxy_request_id: 1,
            },
          };
          const toolRequest = {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {
              cursor: 'bad-cursor',
            },
          };

          nock('https://my-wp-site.com')
            .post(WP_MCP_ENDPOINT, initializeRequest)
            .reply(200, createJsonRpcResult(1, { protocolVersion: '2025-06-18' }), {
              'Mcp-Session-Id': 'session-1',
            });

          nock('https://my-wp-site.com')
            .post(WP_MCP_ENDPOINT, toolRequest)
            .matchHeader('mcp-session-id', 'session-1')
            .reply(200, createJsonRpcError(2, code, message));

          const { wpRequest } = await import('../../src/lib/wordpress-api.js');

          await wpRequest(initializeRequest, true);
          await expect(wpRequest(toolRequest, true)).rejects.toThrow(
            `WordPress JSON-RPC error: ${message}`
          );

          expect(nock.isDone()).toBe(true);
        }
      );

      it('should not retry initialize requests when initialize itself returns an invalid session error', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://my-wp-site.com',
          JWT_TOKEN: 'test-token',
        });

        const initializeRequest = {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            clientInfo: {
              name: 'test-client',
              version: '1.0.0',
            },
            _proxy_request_id: 1,
          },
        };

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT, initializeRequest)
          .reply(200, createJsonRpcError(1, -32602, 'Invalid or expired session'));

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');

        await expect(wpRequest(initializeRequest, true)).rejects.toThrow(
          'WordPress JSON-RPC error: Invalid or expired session'
        );

        expect(nock.isDone()).toBe(true);
      });

      it('should surface the invalid-session error after a single retry attempt', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://my-wp-site.com',
          JWT_TOKEN: 'test-token',
        });

        const initializeRequest = {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            clientInfo: {
              name: 'test-client',
              version: '1.0.0',
            },
            _proxy_request_id: 1,
          },
        };
        const toolRequest = {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        };

        let initCallCount = 0;
        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT, initializeRequest)
          .twice()
          .reply(function () {
            initCallCount += 1;
            return [
              200,
              createJsonRpcResult(1, { protocolVersion: '2025-06-18' }),
              {
                'Mcp-Session-Id': initCallCount === 1 ? 'session-1' : 'session-2',
              },
            ];
          });

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT, toolRequest)
          .matchHeader('mcp-session-id', 'session-1')
          .reply(200, createJsonRpcError(2, -32602, 'Invalid or expired session'));

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT, toolRequest)
          .matchHeader('mcp-session-id', 'session-2')
          .reply(200, createJsonRpcError(2, -32602, 'Invalid or expired session'));

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');

        await wpRequest(initializeRequest, true);
        await expect(wpRequest(toolRequest, true)).rejects.toThrow(
          'WordPress JSON-RPC error: Invalid or expired session'
        );

        expect(nock.isDone()).toBe(true);
      });
    });

    describe('Default parameters', () => {
      it('should handle minimal request data', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://my-wp-site.com',
          JWT_TOKEN: 'test-token',
        });

        nock('https://my-wp-site.com')
          .post(WP_MCP_ENDPOINT, { method: 'init' })
          .reply(200, { status: 'success' });

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        await wpRequest({ method: 'init' });

        expect(nock.isDone()).toBe(true);
      });
    });
  });

  describe('Helper functions', () => {
    describe('constructApiUrl', () => {
      it.each([
        ['bare domain', 'https://my-wp-site.com', WP_MCP_ENDPOINT],
        ['API subdomain', 'https://api.mysite.com', WP_MCP_ENDPOINT],
        ['custom path', 'https://my-wp-site.com/custom', '/custom'],
      ])('routes %s (%s) to correct endpoint', async (_label, url, expectedPath) => {
        restoreEnv = mockEnv({
          WP_API_URL: url,
          JWT_TOKEN: 'test-token',
        });

        const urlObj = new URL(url);
        nock(`${urlObj.protocol}//${urlObj.host}`)
          .post(expectedPath)
          .reply(200, { status: 'success' });

        jest.resetModules();
        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        await wpRequest({ method: 'initialize' });

        expect(nock.isDone()).toBe(true);
        nock.cleanAll();
        if (restoreEnv) restoreEnv();
      });
    });
  });

  describe('OAuth token management', () => {
    it('should handle getOAuthTokens when OAuth is disabled', async () => {
      restoreEnv = mockEnv({
        WP_API_URL: 'https://my-wp-site.com',
        OAUTH_ENABLED: 'false',
        WP_API_USERNAME: 'testuser',
        WP_API_PASSWORD: 'testpass',
      });

      const expectedAuth = Buffer.from('testuser:testpass').toString('base64');

      nock('https://my-wp-site.com')
        .post(WP_MCP_ENDPOINT)
        .matchHeader('authorization', `Basic ${expectedAuth}`)
        .reply(200, { status: 'success' });

      const { wpRequest } = await import('../../src/lib/wordpress-api.js');
      await wpRequest({ method: 'initialize' });

      expect(nock.isDone()).toBe(true);
    });
  });
});
