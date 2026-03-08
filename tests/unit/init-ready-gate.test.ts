/**
 * Tests for the init-ready gate that prevents request handlers from
 * running before transport detection completes.
 *
 * Regression test for: tools/list race condition where requests fired
 * before sessionContext.transportType was set, causing them to be sent
 * without a JSON-RPC envelope.
 */

import { jest } from '@jest/globals';
import nock from 'nock';

describe('init-ready gate', () => {
  let createSessionContext: any;
  let resolveInit: any;
  let prepareRequest: any;
  let waitForInit: any;
  let createRequestHandler: any;
  let HANDLER_CONFIGS: any;
  let context: any;

  beforeAll(async () => {
    // Set env BEFORE modules are imported so CONFIG caches the right values
    process.env.WP_API_URL = 'https://test-wp.example.com';
    process.env.JWT_TOKEN = 'test-jwt-token-for-init-gate-tests';
    process.env.NODE_ENV = 'test';

    jest.resetModules();

    const sessionMod = await import('../../src/lib/session-utils.js');
    createSessionContext = sessionMod.createSessionContext;
    resolveInit = sessionMod.resolveInit;
    prepareRequest = sessionMod.prepareRequest;
    waitForInit = sessionMod.waitForInit;

    const factoryMod = await import('../../src/lib/request-handler-factory.js');
    createRequestHandler = factoryMod.createRequestHandler;
    HANDLER_CONFIGS = factoryMod.HANDLER_CONFIGS;
  });

  afterAll(() => {
    delete process.env.JWT_TOKEN;
    nock.cleanAll();
  });

  beforeEach(() => {
    context = createSessionContext();
    nock.cleanAll();
    // Catch any real HTTP requests that escape the gate
    nock('https://test-wp.example.com')
      .post('/?rest_route=/wp/v2/wpmcp')
      .reply(200, { tools: [] });
  });

  describe('waitForInit', () => {
    it('blocks until resolveInit is called', async () => {
      let resolved = false;
      const waiting = waitForInit(context).then((result: any) => {
        resolved = true;
        return result;
      });

      await Promise.resolve();
      expect(resolved).toBe(false);

      resolveInit(context, false);
      const result = await waiting;

      expect(resolved).toBe(true);
      expect(result).toEqual({ ready: true });
    });

    it('returns failed reason when init failed', async () => {
      resolveInit(context, true);

      const result = await waitForInit(context);
      expect(result).toEqual({ ready: false, reason: 'failed' });
    });

    it('short-circuits after init already settled', async () => {
      resolveInit(context, false);

      // First call settles normally
      expect(await waitForInit(context)).toEqual({ ready: true });
      // Second call should return immediately (fast path)
      expect(await waitForInit(context)).toEqual({ ready: true });
    });

    it('times out if init never resolves', async () => {
      const result = await waitForInit(context, 50);
      expect(result).toEqual({ ready: false, reason: 'timeout' });

      // Resolve the dangling promise so Jest can exit cleanly
      resolveInit(context, false);
    });
  });

  describe('request handler waits for init', () => {
    it('tools/list handler blocks until init completes', async () => {
      const handler = createRequestHandler(HANDLER_CONFIGS.listTools, context);
      let handlerResolved = false;

      const handlerPromise = handler({ params: {} }).then((result: any) => {
        handlerResolved = true;
        return result;
      });

      // Handler should be blocked — flush microtasks without wall-clock delay
      await Promise.resolve();
      await Promise.resolve();
      expect(handlerResolved).toBe(false);

      // Simulate successful init completing
      context.transportType = 'jsonrpc';
      resolveInit(context, false);

      await handlerPromise;
      expect(handlerResolved).toBe(true);
    });

    it('handler throws when init failed', async () => {
      const handler = createRequestHandler(HANDLER_CONFIGS.listTools, context);

      resolveInit(context, true);

      await expect(handler({ params: {} })).rejects.toThrow(
        'Cannot process tools/list: WordPress connection failed during initialization'
      );
    });

    it('handler times out with error when init never completes', async () => {
      const handler = createRequestHandler(HANDLER_CONFIGS.listTools, context);

      const timeoutPromise = handler({ params: {} });

      // Simulate timeout by resolving init as failed after a short delay
      setTimeout(() => resolveInit(context, true), 50);

      await expect(timeoutPromise).rejects.toThrow(
        'WordPress connection failed during initialization'
      );
    });
  });

  describe('race condition regression', () => {
    it('tools/list uses correct transport even when fired immediately after init', async () => {
      nock.cleanAll();
      let capturedBody: any = null;
      nock('https://test-wp.example.com')
        .post('/?rest_route=/wp/v2/wpmcp', (body: any) => {
          capturedBody = body;
          return true;
        })
        .reply(200, { tools: [] });

      const handler = createRequestHandler(HANDLER_CONFIGS.listTools, context);

      // Fire tools/list immediately (simulates MCP SDK behavior on startup)
      const handlerPromise = handler({ id: 1, params: {} });

      // Simulate init completing with jsonrpc transport
      context.transportType = 'jsonrpc';
      context.sessionId = 'test-session';
      resolveInit(context, false);

      await handlerPromise;

      // The request body must contain a JSON-RPC envelope
      expect(capturedBody).toHaveProperty('jsonrpc', '2.0');
      expect(capturedBody).toHaveProperty('method', 'tools/list');
    });

    it('prepareRequest falls through to simple format when transportType is null', () => {
      // Documents the original bug: without the gate, transportType is null
      // and requests get sent without a JSON-RPC envelope
      const wpParams = { method: 'tools/list' };
      const mcpRequest = { id: 1 };

      // Before init: transportType is null -> no jsonrpc envelope
      const result = prepareRequest(wpParams, mcpRequest, context);
      expect(result).not.toHaveProperty('jsonrpc');
      expect(result).toEqual({ method: 'tools/list' });

      // After init: transportType is 'jsonrpc' -> full envelope
      context.transportType = 'jsonrpc';
      const resultAfter = prepareRequest(wpParams, mcpRequest, context);
      expect(resultAfter).toHaveProperty('jsonrpc', '2.0');
      expect(resultAfter).toHaveProperty('method', 'tools/list');
    });

    it('multiple concurrent handlers all unblock when init completes', async () => {
      nock.cleanAll();
      nock('https://test-wp.example.com')
        .post('/?rest_route=/wp/v2/wpmcp')
        .times(3)
        .reply(200, { tools: [{ name: 'test-tool' }] });

      const toolsHandler = createRequestHandler(HANDLER_CONFIGS.listTools, context);
      const resourcesHandler = createRequestHandler(HANDLER_CONFIGS.listResources, context);
      const promptsHandler = createRequestHandler(HANDLER_CONFIGS.listPrompts, context);

      // Fire three handlers concurrently before init
      const p1 = toolsHandler({ id: 1, params: {} });
      const p2 = resourcesHandler({ id: 2, params: {} });
      const p3 = promptsHandler({ id: 3, params: {} });

      // Complete init
      context.transportType = 'jsonrpc';
      resolveInit(context, false);

      // All three should resolve successfully with response data
      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
      expect(r1).toHaveProperty('tools');
      expect(r2).toHaveProperty('tools');
      expect(r3).toHaveProperty('tools');
    });
  });
});
