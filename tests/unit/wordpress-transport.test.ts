import { jest } from '@jest/globals';

describe('WordPress transport authentication deadline', () => {
  it('starts the request deadline after authentication, so a slow login does not time out', async () => {
    const previous = process.env.WP_API_INIT_TIMEOUT_MS;
    process.env.WP_API_INIT_TIMEOUT_MS = '20';
    jest.resetModules();
    const api = await import('../../src/lib/wordpress-api.js');
    const fetch = await import('../../src/lib/fetch-utils.js');
    const headers = jest.spyOn(api, 'getWordPressHeaders').mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      return { Authorization: 'Bearer fixture-token' };
    });
    const network = jest
      .spyOn(fetch, 'proxyFetch')
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-11-25' } }),
            { headers: { 'Content-Type': 'application/json' } }
          ) as any
      );
    const failures: any[] = [];
    const transport = (
      await import('../../src/lib/wordpress-transport.js')
    ).createWordPressTransport((_message, error) => failures.push(error));
    const received: unknown[] = [];
    transport.onmessage = message => received.push(message);
    transport.onerror = () => {};
    try {
      await transport.start();
      await transport.send({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25' },
      });
      expect(network).toHaveBeenCalledTimes(1);
      expect(failures).toEqual([]);
      expect(received).toEqual([
        { jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-11-25' } },
      ]);
    } finally {
      await transport.close();
      headers.mockRestore();
      network.mockRestore();
      if (previous === undefined) delete process.env.WP_API_INIT_TIMEOUT_MS;
      else process.env.WP_API_INIT_TIMEOUT_MS = previous;
    }
  });
});

describe('WordPress transport rejected OAuth token', () => {
  const initialize = {
    jsonrpc: '2.0' as const,
    id: 0,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25' },
  };
  const rejected = () =>
    new Response(
      JSON.stringify({ code: 'oauth2_invalid_token', message: 'The OAuth2 token is invalid.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    ) as any;
  const accepted = () =>
    new Response(
      JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-11-25' } }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    ) as any;

  let tempDir: string;
  let restoreEnv: () => void;

  beforeEach(async () => {
    const { mockEnv } = await import('../utils/test-helpers.js');
    const tmp = (await import('tmp')).default;
    tempDir = tmp.dirSync({ unsafeCleanup: true }).name;
    restoreEnv = mockEnv({
      WP_MCP_CONFIG_DIR: tempDir,
      WP_API_URL: 'https://example.test/mcp',
      OAUTH_ENABLED: 'true',
    });
    delete process.env.JWT_TOKEN;
    jest.resetModules();
  });

  afterEach(async () => {
    restoreEnv();
    (await import('fs')).rmSync(tempDir, { recursive: true, force: true });
  });

  async function setup(responses: Array<() => any>) {
    const auth = await import('../../src/lib/persistent-auth-config.js');
    const api = await import('../../src/lib/wordpress-api.js');
    const fetch = await import('../../src/lib/fetch-utils.js');
    const serverUrlHash = auth.generateServerUrlHash('https://example.test/mcp');
    await auth.writeTokens(serverUrlHash, {
      access_token: 'stored-token',
      token_type: 'bearer',
      obtained_at: Date.now(),
    });
    const { MCPOAuthProvider } = await import('../../src/lib/mcp-oauth-provider.js');
    jest.spyOn(MCPOAuthProvider.prototype, 'authorize').mockImplementation(async () => {
      const tokens = await auth.readTokens(serverUrlHash);
      if (tokens?.access_token === 'stored-token')
        await auth.writeTokens(serverUrlHash, {
          access_token: 'new-token',
          token_type: 'Bearer',
          obtained_at: Date.now(),
        });
    });
    jest.spyOn(api, 'getWordPressHeaders').mockImplementation(async () => {
      const tokens = await auth.readTokens(serverUrlHash);
      return { Authorization: `Bearer ${tokens ? tokens.access_token : 'new-token'}` };
    });
    const network = jest
      .spyOn(fetch, 'proxyFetch')
      .mockImplementation(async () => (responses.shift() ?? rejected)());
    const failures: any[] = [];
    const transport = (
      await import('../../src/lib/wordpress-transport.js')
    ).createWordPressTransport((_message, error) => failures.push(error));
    const received: unknown[] = [];
    transport.onmessage = message => received.push(message);
    transport.onerror = () => {};
    await transport.start();
    const sentAuthorization = () =>
      network.mock.calls.map(([, init]) => new Headers(init?.headers).get('Authorization'));
    return { auth, serverUrlHash, network, failures, received, transport, sentAuthorization };
  }

  it('recovers the rejected token and retries once with its replacement', async () => {
    const { auth, serverUrlHash, failures, received, transport, sentAuthorization } = await setup([
      rejected,
      accepted,
    ]);
    try {
      await transport.send(initialize);
      expect(sentAuthorization()).toEqual(['Bearer stored-token', 'Bearer new-token']);
      expect((await auth.readTokens(serverUrlHash))?.access_token).toBe('new-token');
      expect(failures).toEqual([]);
      expect(received).toEqual([
        { jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-11-25' } },
      ]);
    } finally {
      await transport.close();
      jest.restoreAllMocks();
    }
  });

  it('does not retry a second time when the new token is also rejected', async () => {
    const { failures, transport, sentAuthorization } = await setup([rejected, rejected]);
    try {
      await transport.send(initialize).catch(() => {});
      expect(sentAuthorization()).toEqual(['Bearer stored-token', 'Bearer new-token']);
      expect(failures.map(error => error.statusCode)).toEqual([401]);
    } finally {
      await transport.close();
      jest.restoreAllMocks();
    }
  });

  it('retries without reporting a failure when the 401 body arrives late', async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const delayedRejection = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            timer = setTimeout(() => {
              controller.enqueue(new TextEncoder().encode('{"code":"oauth2_invalid_token"}'));
              controller.close();
            }, 50);
          },
          cancel() {
            clearTimeout(timer);
          },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      ) as any;
    const { failures, received, transport, sentAuthorization } = await setup([
      delayedRejection,
      accepted,
    ]);
    try {
      await transport.send(initialize);
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(sentAuthorization()).toEqual(['Bearer stored-token', 'Bearer new-token']);
      expect(failures).toEqual([]);
      expect(received).toEqual([
        { jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-11-25' } },
      ]);
    } finally {
      await transport.close();
      jest.restoreAllMocks();
    }
  });

  it('does not retry a request cancelled while the rejected token is discarded', async () => {
    const api = await import('../../src/lib/wordpress-api.js');
    const { transport, sentAuthorization } = await setup([rejected, accepted]);
    jest.spyOn(api, 'recoverOAuthAuthorization').mockImplementation(async () => {
      transport.cancelRequest(5);
      return true;
    });
    try {
      await transport.send({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'delete_post', arguments: { id: 1 } },
      });
      expect(sentAuthorization()).toEqual(['Bearer stored-token']);
    } finally {
      await transport.close();
      jest.restoreAllMocks();
    }
  });

  it('retries with the newer stored token when an older token was rejected', async () => {
    const { auth, serverUrlHash, transport, sentAuthorization } = await setup([rejected]);
    await auth.writeTokens(serverUrlHash, {
      access_token: 'newer-token',
      token_type: 'bearer',
      obtained_at: Date.now(),
    });
    jest
      .spyOn(await import('../../src/lib/wordpress-api.js'), 'getWordPressHeaders')
      .mockResolvedValueOnce({ Authorization: 'Bearer stored-token' })
      .mockResolvedValueOnce({ Authorization: 'Bearer newer-token' });
    try {
      await transport.send(initialize).catch(() => {});
      expect(sentAuthorization()).toEqual(['Bearer stored-token', 'Bearer newer-token']);
      expect((await auth.readTokens(serverUrlHash))?.access_token).toBe('newer-token');
    } finally {
      await transport.close();
      jest.restoreAllMocks();
    }
  });

  it('retries when the 401 carries a Bearer challenge', async () => {
    const bearerRejected = () =>
      new Response(JSON.stringify({ code: 'oauth2_invalid_token' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate':
            'Bearer resource_metadata="https://example.test/.well-known/oauth-protected-resource"',
        },
      }) as any;
    const { failures, transport, sentAuthorization } = await setup([bearerRejected, accepted]);
    try {
      await transport.send(initialize);
      expect(sentAuthorization()).toEqual(['Bearer stored-token', 'Bearer new-token']);
      expect(failures).toEqual([]);
    } finally {
      await transport.close();
      jest.restoreAllMocks();
    }
  });

  it('keeps the stored token when the 401 asks for other credentials', async () => {
    const basicRequired = () =>
      new Response('Authorization Required', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="staging"' },
      }) as any;
    const { auth, serverUrlHash, failures, transport, sentAuthorization } = await setup([
      basicRequired,
    ]);
    try {
      await transport.send(initialize).catch(() => {});
      expect(sentAuthorization()).toEqual(['Bearer stored-token']);
      expect((await auth.readTokens(serverUrlHash))?.access_token).toBe('stored-token');
      expect(failures.map(error => error.statusCode)).toEqual([401]);
    } finally {
      await transport.close();
      jest.restoreAllMocks();
    }
  });
});

describe('WordPress transport released response bodies', () => {
  async function setup(responses: Array<(signal: AbortSignal | null | undefined) => Response>) {
    jest.resetModules();
    const api = await import('../../src/lib/wordpress-api.js');
    const fetch = await import('../../src/lib/fetch-utils.js');
    jest
      .spyOn(api, 'getWordPressHeaders')
      .mockResolvedValue({ Authorization: 'Bearer fixture-token' });
    const network = jest
      .spyOn(fetch, 'proxyFetch')
      .mockImplementation(
        async (_url, init) =>
          (responses.shift() ?? (() => new Response('', { status: 405 })))(init?.signal) as any
      );
    const failures: any[] = [];
    const transport = (
      await import('../../src/lib/wordpress-transport.js')
    ).createWordPressTransport((_message, error) => failures.push(error));
    transport.onerror = () => {};
    await transport.start();
    return { network, failures, transport };
  }

  it('stays quiet when the SDK releases a 202 body and a 405 event stream', async () => {
    const { network, failures, transport } = await setup([
      () => new Response('', { status: 202 }),
      () => new Response('', { status: 405 }),
    ]);
    try {
      await transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(network).toHaveBeenCalledTimes(2);
      expect(failures).toEqual([]);
    } finally {
      await transport.close();
      jest.restoreAllMocks();
    }
  });

  it('stays quiet when closing the transport aborts the open event stream', async () => {
    const { failures, transport } = await setup([
      () => new Response('', { status: 202 }),
      signal =>
        new Response(
          new ReadableStream({
            start(controller) {
              signal?.addEventListener('abort', () =>
                controller.error(new DOMException('This operation was aborted', 'AbortError'))
              );
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
        ),
    ]);
    try {
      await transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      await new Promise(resolve => setTimeout(resolve, 50));
      await transport.close();
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(failures).toEqual([]);
    } finally {
      jest.restoreAllMocks();
    }
  });
});

describe('WordPress transport scope authorization limits', () => {
  let restoreTimeout: string | undefined;
  beforeEach(() => {
    restoreTimeout = process.env.WP_API_INIT_TIMEOUT_MS;
    process.env.WP_API_INIT_TIMEOUT_MS = '20';
    jest.resetModules();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (restoreTimeout === undefined) delete process.env.WP_API_INIT_TIMEOUT_MS;
    else process.env.WP_API_INIT_TIMEOUT_MS = restoreTimeout;
  });

  async function setup() {
    const api = await import('../../src/lib/wordpress-api.js');
    jest.spyOn(api, 'getWordPressHeaders').mockResolvedValue({ Authorization: 'Bearer fixture' });
    const recover = jest.spyOn(api, 'recoverOAuthAuthorization').mockResolvedValue(true);
    const fetch = await import('../../src/lib/fetch-utils.js');
    const network = jest.spyOn(fetch, 'proxyFetch');
    const failures: Error[] = [];
    const transport = (
      await import('../../src/lib/wordpress-transport.js')
    ).createWordPressTransport((_message, error) => failures.push(error));
    transport.onerror = () => {};
    await transport.start();
    return { recover, network, failures, transport };
  }

  it('does not repeat identical scope challenges or exceed two upgrades per operation', async () => {
    const c = await setup();
    let scope = 'write';
    c.network.mockImplementation(
      async () =>
        new Response('forbidden', {
          status: 403,
          headers: { 'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${scope}"` },
        }) as any
    );
    const send = () =>
      c.transport
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'fixture', arguments: {} },
        })
        .catch(() => {});
    try {
      await send();
      expect(c.recover).toHaveBeenCalledTimes(1);
      await send();
      expect(c.recover).toHaveBeenCalledTimes(1);
      scope = 'admin';
      await send();
      expect(c.recover).toHaveBeenCalledTimes(2);
      scope = 'sites:write';
      await send();
      expect(c.recover).toHaveBeenCalledTimes(2);
    } finally {
      await c.transport.close();
    }
  });

  it('pauses the HTTP deadline during consent without losing client cancellation', async () => {
    const c = await setup();
    c.network.mockResolvedValue(
      new Response('forbidden', {
        status: 403,
        headers: { 'WWW-Authenticate': 'Bearer error="insufficient_scope", scope="write"' },
      }) as any
    );
    c.recover.mockImplementation(async () => {
      c.transport.cancelRequest(5);
      await new Promise(resolve => setTimeout(resolve, 40));
      return true;
    });
    try {
      await c.transport.send({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'fixture' },
      });
      expect(c.network).toHaveBeenCalledTimes(1);
      expect(c.failures).toEqual([]);
    } finally {
      await c.transport.close();
    }
  });

  it('allows consent longer than the request deadline and retries successfully', async () => {
    const c = await setup();
    c.recover.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 40));
      return true;
    });
    c.network
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }) as any)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-11-25' } }),
          { headers: { 'Content-Type': 'application/json' } }
        ) as any
      );
    try {
      await c.transport.send({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25' },
      });
      expect(c.network).toHaveBeenCalledTimes(2);
      expect(c.failures).toEqual([]);
    } finally {
      await c.transport.close();
    }
  });
});
