import { jest } from '@jest/globals';
import nock from 'nock';

describe('tool-call hooks', () => {
  let createSessionContext: any;
  let resolveInit: any;
  let createRequestHandler: any;
  let HANDLER_CONFIGS: any;
  let registerToolCallHook: any;
  let context: any;
  let unregisterHooks: Array<() => void>;

  beforeAll(async () => {
    process.env.WP_API_URL = 'https://test-wp.example.com';
    process.env.JWT_TOKEN = 'test-jwt-token-for-hook-tests';
    process.env.NODE_ENV = 'test';

    jest.resetModules();

    const sessionModule = await import('../../src/lib/session-utils.js');
    createSessionContext = sessionModule.createSessionContext;
    resolveInit = sessionModule.resolveInit;

    const handlerModule = await import('../../src/lib/request-handler-factory.js');
    createRequestHandler = handlerModule.createRequestHandler;
    HANDLER_CONFIGS = handlerModule.HANDLER_CONFIGS;

    const hooksModule = await import('../../src/lib/tool-call-hooks.js');
    registerToolCallHook = hooksModule.registerToolCallHook;
  });

  afterAll(() => {
    delete process.env.JWT_TOKEN;
    nock.cleanAll();
  });

  beforeEach(() => {
    context = createSessionContext();
    unregisterHooks = [];
    nock.cleanAll();
  });

  afterEach(() => {
    for (const unregister of unregisterHooks) {
      unregister();
    }
  });

  function addHook(hook: any): () => void {
    const unregister = registerToolCallHook(hook);
    unregisterHooks.push(unregister);
    return unregister;
  }

  function readyHandler(transportType: 'jsonrpc' | 'simple') {
    context.transportType = transportType;
    resolveInit(context, false);
    return createRequestHandler(HANDLER_CONFIGS.callTool, context);
  }

  function mockToolCalls(times = 1, response: any = { content: [] }) {
    const bodies: any[] = [];
    nock('https://test-wp.example.com')
      .post('/?rest_route=/wp/v2/wpmcp', (body: any) => {
        bodies.push(body);
        return true;
      })
      .times(times)
      .reply(200, response);
    return bodies;
  }

  async function flushHooks() {
    await new Promise<void>(resolve => setImmediate(resolve));
  }

  it('runs hooks after a completed tools/call', async () => {
    mockToolCalls();
    const calls: string[] = [];
    addHook(({ name }: { name: string }) => calls.push(name));

    const response = await readyHandler('jsonrpc')({
      id: 1,
      params: { name: 'my-tool', arguments: { value: 1 } },
    });

    expect(response).toEqual({ content: [] });
    expect(calls).toEqual([]);

    await flushHooks();
    expect(calls).toEqual(['my-tool']);
  });

  it('does not interpret the WordPress response before running hooks', async () => {
    const response = { content: 'validation belongs to the MCP client' };
    mockToolCalls(1, response);
    const calls: string[] = [];
    addHook(() => calls.push('called'));

    await expect(readyHandler('jsonrpc')({ id: 1, params: { name: 'my-tool' } })).resolves.toEqual(
      response
    );
    await flushHooks();

    expect(calls).toEqual(['called']);
  });

  it('does not run hooks for other methods', async () => {
    nock('https://test-wp.example.com').post('/?rest_route=/wp/v2/wpmcp').reply(200, { tools: [] });
    const calls: string[] = [];
    addHook(() => calls.push('called'));

    context.transportType = 'jsonrpc';
    resolveInit(context, false);
    const listTools = createRequestHandler(HANDLER_CONFIGS.listTools, context);
    await listTools({ id: 1, params: {} });
    await flushHooks();

    expect(calls).toEqual([]);
  });

  it('does not run hooks when the WordPress request fails', async () => {
    nock('https://test-wp.example.com')
      .post('/?rest_route=/wp/v2/wpmcp')
      .replyWithError(new Error('boom'));
    const calls: string[] = [];
    addHook(() => calls.push('called'));

    await expect(
      readyHandler('jsonrpc')({ id: 1, params: { name: 'my-tool' } })
    ).rejects.toBeDefined();
    await flushHooks();

    expect(calls).toEqual([]);
  });

  it('isolates synchronous throws and asynchronous rejections', async () => {
    mockToolCalls();
    addHook(() => {
      throw new Error('sync failure');
    });
    addHook(async () => {
      throw new Error('async failure');
    });
    const calls: string[] = [];
    addHook(() => calls.push('called'));

    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      await expect(
        readyHandler('jsonrpc')({ id: 1, params: { name: 'my-tool' } })
      ).resolves.toEqual({ content: [] });
      await flushHooks();

      expect(calls).toEqual(['called']);
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('stops calling an unregistered hook', async () => {
    mockToolCalls(2);
    const calls: string[] = [];
    const unregister = addHook(() => calls.push('called'));
    const handler = readyHandler('jsonrpc');

    await handler({ id: 1, params: { name: 'my-tool' } });
    await flushHooks();
    unregister();
    await handler({ id: 2, params: { name: 'my-tool' } });
    await flushHooks();

    expect(calls).toEqual(['called']);
  });

  it.each([
    ['simple', false],
    ['jsonrpc', true],
  ] as const)('binds hook requests to the %s transport', async (transportType, useJsonRpc) => {
    const bodies = mockToolCalls(2);
    let resolveHookRequest: () => void;
    const hookRequestCompleted = new Promise<void>(resolve => {
      resolveHookRequest = resolve;
    });
    addHook(async ({ wpRequest }: any) => {
      await wpRequest({
        method: 'tools/call',
        name: 'telemetry-tool',
        arguments: { event: 'test' },
      });
      resolveHookRequest();
    });

    await readyHandler(transportType)({ id: 1, params: { name: 'my-tool' } });
    await hookRequestCompleted;

    expect(bodies).toHaveLength(2);
    if (useJsonRpc) {
      expect(bodies[1]).toMatchObject({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'telemetry-tool' },
      });
    } else {
      expect(bodies[1]).toMatchObject({ method: 'tools/call', name: 'telemetry-tool' });
      expect(bodies[1]).not.toHaveProperty('jsonrpc');
    }
  });
});
