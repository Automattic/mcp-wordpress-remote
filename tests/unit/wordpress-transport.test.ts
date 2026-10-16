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
    // Stands in for the sign-in that runs when no stored token is left.
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

  it('deletes the rejected token and retries once with a new sign-in', async () => {
    const { auth, serverUrlHash, failures, received, transport, sentAuthorization } = await setup([
      rejected,
      accepted,
    ]);
    try {
      await transport.send(initialize);
      expect(sentAuthorization()).toEqual(['Bearer stored-token', 'Bearer new-token']);
      expect(await auth.readTokens(serverUrlHash)).toBeNull();
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
    jest.spyOn(api, 'discardRejectedOAuthToken').mockImplementation(async () => {
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

  it('keeps the stored token when the rejected request used a different one', async () => {
    const { auth, serverUrlHash, transport, sentAuthorization } = await setup([rejected]);
    await auth.writeTokens(serverUrlHash, {
      access_token: 'newer-token',
      token_type: 'bearer',
      obtained_at: Date.now(),
    });
    jest
      .spyOn(await import('../../src/lib/wordpress-api.js'), 'getWordPressHeaders')
      .mockResolvedValue({ Authorization: 'Bearer stored-token' });
    try {
      await transport.send(initialize).catch(() => {});
      expect(sentAuthorization()).toEqual(['Bearer stored-token']);
      expect((await auth.readTokens(serverUrlHash))?.access_token).toBe('newer-token');
    } finally {
      await transport.close();
      jest.restoreAllMocks();
    }
  });
});
