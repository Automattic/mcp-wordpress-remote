/**
 * Tests for post-tool-call hooks (registerToolCallHook / runToolCallHooks).
 *
 * Covers the PR #92 review requirements:
 * - hooks fire only after a successful tools/call
 * - hooks do not fire for a malformed (schema-invalid) tool result
 * - hook work is deferred until after the tool-call handler resolves
 * - a synchronously throwing hook never affects the client response
 * - an async (rejecting) hook never becomes an unhandled rejection
 * - hook failures are logged, not silently swallowed
 * - a logging failure cannot reopen either hook failure path
 * - unregistration stops a hook from firing
 * - a hook that unregisters and re-registers itself cannot loop the pass
 * - the hook's wpRequest dispatches with the session's detected transport
 *   (simple format on simple sessions, JSON-RPC envelope on jsonrpc sessions)
 */

import { jest } from '@jest/globals';
import nock from 'nock';

describe('tool-call hooks', () => {
  let createSessionContext: any;
  let resolveInit: any;
  let createRequestHandler: any;
  let HANDLER_CONFIGS: any;
  let registerToolCallHook: any;
  let logger: any;
  let context: any;
  let unregisterFns: Array<() => void>;

  beforeAll(async () => {
    // Set env BEFORE modules are imported so CONFIG caches the right values
    process.env.WP_API_URL = 'https://test-wp.example.com';
    process.env.JWT_TOKEN = 'test-jwt-token-for-hook-tests';
    process.env.NODE_ENV = 'test';

    jest.resetModules();

    const sessionMod = await import('../../src/lib/session-utils.js');
    createSessionContext = sessionMod.createSessionContext;
    resolveInit = sessionMod.resolveInit;

    const factoryMod = await import('../../src/lib/request-handler-factory.js');
    createRequestHandler = factoryMod.createRequestHandler;
    HANDLER_CONFIGS = factoryMod.HANDLER_CONFIGS;

    const hooksMod = await import('../../src/lib/tool-call-hooks.js');
    registerToolCallHook = hooksMod.registerToolCallHook;

    const utilsMod = await import('../../src/lib/utils.js');
    logger = utilsMod.logger;
  });

  afterAll(() => {
    delete process.env.JWT_TOKEN;
    nock.cleanAll();
  });

  beforeEach(() => {
    context = createSessionContext();
    unregisterFns = [];
    nock.cleanAll();
  });

  afterEach(() => {
    // The registry is global — always clean up hooks so tests stay isolated
    for (const unregister of unregisterFns) {
      unregister();
    }
  });

  /** Register a hook and track it for cleanup. */
  function addHook(hook: any): () => void {
    const unregister = registerToolCallHook(hook);
    unregisterFns.push(unregister);
    return unregister;
  }

  /** Prepare a ready session and a callTool handler. */
  function readyHandler(transportType: 'jsonrpc' | 'simple') {
    context.transportType = transportType;
    resolveInit(context, false);
    return createRequestHandler(HANDLER_CONFIGS.callTool, context);
  }

  function mockToolCall(times = 1) {
    const bodies: any[] = [];
    nock('https://test-wp.example.com')
      .post('/?rest_route=/wp/v2/wpmcp', (body: any) => {
        bodies.push(body);
        return true;
      })
      .times(times)
      .reply(200, { content: [{ type: 'text', text: 'ok' }] });
    return bodies;
  }

  /** Flush microtasks and pending macrotasks so fire-and-forget hooks settle. */
  async function flush() {
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
  }

  it('runs hooks after a successful tools/call with the tool name', async () => {
    mockToolCall();
    const calls: any[] = [];
    addHook((hookContext: any) => {
      calls.push(hookContext.name);
    });

    const handler = readyHandler('jsonrpc');
    await handler({ id: 1, params: { name: 'my-tool', arguments: { a: 1 } } });
    await flush();

    expect(calls).toEqual(['my-tool']);
  });

  it('does not run hooks for non-tools/call methods', async () => {
    nock('https://test-wp.example.com').post('/?rest_route=/wp/v2/wpmcp').reply(200, { tools: [] });
    const calls: any[] = [];
    addHook(() => {
      calls.push('called');
    });

    context.transportType = 'jsonrpc';
    resolveInit(context, false);
    const handler = createRequestHandler(HANDLER_CONFIGS.listTools, context);
    await handler({ id: 1, params: {} });
    await flush();

    expect(calls).toEqual([]);
  });

  it('does not run hooks when the tool call fails', async () => {
    nock('https://test-wp.example.com')
      .post('/?rest_route=/wp/v2/wpmcp')
      .replyWithError(new Error('boom'));
    const calls: any[] = [];
    addHook(() => {
      calls.push('called');
    });

    const handler = readyHandler('jsonrpc');
    await expect(handler({ id: 1, params: { name: 'my-tool' } })).rejects.toBeDefined();
    await flush();

    expect(calls).toEqual([]);
  });

  it('does not run hooks when the tool result is malformed', async () => {
    // HTTP 200, but not a valid CallToolResult — the SDK will reject this
    // after the handler returns, so the call fails for the client and hooks
    // must not observe it as a success.
    nock('https://test-wp.example.com')
      .post('/?rest_route=/wp/v2/wpmcp')
      .reply(200, { content: 'not-an-array' });
    const calls: any[] = [];
    addHook(() => {
      calls.push('called');
    });

    const handler = readyHandler('jsonrpc');
    await handler({ id: 1, params: { name: 'my-tool' } });
    await flush();

    expect(calls).toEqual([]);
  });

  it('defers hook work until after the tool-call handler resolves', async () => {
    mockToolCall();
    const calls: string[] = [];
    addHook(() => {
      calls.push('called');
    });

    const handler = readyHandler('jsonrpc');
    const response = await handler({ id: 1, params: { name: 'my-tool' } });

    expect(response).toEqual({ content: [{ type: 'text', text: 'ok' }] });
    expect(calls).toEqual([]);

    await flush();
    expect(calls).toEqual(['called']);
  });

  it('a synchronously throwing hook does not affect the client response', async () => {
    mockToolCall();
    addHook(() => {
      throw new Error('sync hook failure');
    });
    const calls: any[] = [];
    addHook((hookContext: any) => {
      calls.push(hookContext.name);
    });

    const handler = readyHandler('jsonrpc');
    const response = await handler({ id: 1, params: { name: 'my-tool' } });
    await flush();

    expect(response).toEqual({ content: [{ type: 'text', text: 'ok' }] });
    // Other hooks still ran despite the throwing one
    expect(calls).toEqual(['my-tool']);
  });

  it('an async rejecting hook is consumed, not an unhandled rejection', async () => {
    mockToolCall();
    addHook(async () => {
      throw new Error('async hook failure');
    });

    const unhandled: unknown[] = [];
    const onRejection = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onRejection);

    try {
      const handler = readyHandler('jsonrpc');
      const response = await handler({ id: 1, params: { name: 'my-tool' } });
      await flush();

      expect(response).toEqual({ content: [{ type: 'text', text: 'ok' }] });
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it('logs a failing hook instead of silently swallowing it', async () => {
    mockToolCall();
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    try {
      addHook(() => {
        throw new Error('sync hook failure');
      });
      addHook(async () => {
        throw new Error('async hook failure');
      });

      const handler = readyHandler('jsonrpc');
      await handler({ id: 1, params: { name: 'my-tool' } });
      await flush();

      const messages = errorSpy.mock.calls.map((call: any[]) => call[0]);
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.stringContaining('sync hook failure'),
          expect.stringContaining('async hook failure'),
        ])
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('a logging failure cannot reopen synchronous or asynchronous hook failures', async () => {
    mockToolCall();
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {
      throw new Error('logger failure');
    });
    const unhandled: unknown[] = [];
    const onRejection = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onRejection);

    try {
      addHook(() => {
        throw new Error('sync hook failure');
      });
      addHook(async () => {
        throw new Error('async hook failure');
      });

      const handler = readyHandler('jsonrpc');
      const response = await handler({ id: 1, params: { name: 'my-tool' } });
      await flush();

      expect(response).toEqual({ content: [{ type: 'text', text: 'ok' }] });
      expect(errorSpy).toHaveBeenCalledTimes(2);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
      errorSpy.mockRestore();
    }
  });

  it('an unregistered hook no longer fires', async () => {
    mockToolCall(2);
    const calls: any[] = [];
    const unregister = addHook(() => {
      calls.push('called');
    });

    const handler = readyHandler('jsonrpc');
    await handler({ id: 1, params: { name: 'my-tool' } });
    await flush();
    expect(calls).toHaveLength(1);

    unregister();
    await handler({ id: 2, params: { name: 'my-tool' } });
    await flush();
    expect(calls).toHaveLength(1);
  });

  it('a hook that unregisters and re-registers itself runs once per pass', async () => {
    // Regression: iterating the live Set would re-visit a hook the pass
    // re-appended, looping forever and never returning the tool call.
    mockToolCall(2);
    let calls = 0;
    let unregister: () => void;
    const hook = () => {
      calls++;
      unregister();
      unregister = addHook(hook);
    };
    unregister = addHook(hook);

    const handler = readyHandler('jsonrpc');
    await handler({ id: 1, params: { name: 'my-tool' } });
    await flush();
    expect(calls).toBe(1);

    // The re-registered hook still fires on the next pass
    await handler({ id: 2, params: { name: 'my-tool' } });
    await flush();
    expect(calls).toBe(2);
  });

  it('hook wpRequest sends simple format on a simple-transport session', async () => {
    const bodies = mockToolCall(2);
    let hookDispatched: (value?: unknown) => void;
    const dispatched = new Promise(resolve => {
      hookDispatched = resolve;
    });
    addHook(async (hookContext: any) => {
      await hookContext.wpRequest({
        method: 'tools/call',
        name: 'telemetry-tool',
        arguments: { event: 'test' },
      });
      hookDispatched();
    });

    const handler = readyHandler('simple');
    await handler({ id: 1, params: { name: 'my-tool' } });
    await dispatched;

    expect(bodies).toHaveLength(2);
    // The hook's request must NOT carry a JSON-RPC envelope on a simple session
    expect(bodies[1]).not.toHaveProperty('jsonrpc');
    expect(bodies[1]).toMatchObject({ method: 'tools/call', name: 'telemetry-tool' });
  });

  it('hook wpRequest sends a JSON-RPC envelope on a jsonrpc session', async () => {
    const bodies = mockToolCall(2);
    let hookDispatched: (value?: unknown) => void;
    const dispatched = new Promise(resolve => {
      hookDispatched = resolve;
    });
    addHook(async (hookContext: any) => {
      await hookContext.wpRequest({
        method: 'tools/call',
        name: 'telemetry-tool',
        arguments: { event: 'test' },
      });
      hookDispatched();
    });

    const handler = readyHandler('jsonrpc');
    await handler({ id: 1, params: { name: 'my-tool' } });
    await dispatched;

    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toHaveProperty('jsonrpc', '2.0');
    expect(bodies[1]).toHaveProperty('method', 'tools/call');
    expect(bodies[1].params).toMatchObject({ name: 'telemetry-tool' });
  });
});
