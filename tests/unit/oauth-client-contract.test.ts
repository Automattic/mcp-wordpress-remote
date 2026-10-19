import { jest } from '@jest/globals';
import nock from 'nock';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { mockEnv } from '../utils/test-helpers.js';

describe('MCP native OAuth client contract', () => {
  const serverUrl = 'https://resource.example/mcp';
  const issuer = 'https://issuer.example';
  let directory: string;
  let restore: () => void;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'oauth-contract-'));
    restore = mockEnv({
      WP_API_URL: serverUrl,
      WP_MCP_CONFIG_DIR: directory,
      WP_OAUTH_CLIENT_ID: '',
      OAUTH_SCOPES: '',
      OAUTH_ENABLED: 'true',
      OAUTH_TIMEOUT_MS: '500',
      OAUTH_CALLBACK_PORT: '',
      OAUTH_RESOURCE_INDICATOR: 'true',
      USE_SYSTEM_PROXY: 'false',
      SOCKS_PROXY: '',
      LOG_FILE: '',
      LOG_LEVEL: '0',
    });
    jest.resetModules();
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });
  afterEach(() => {
    jest.restoreAllMocks();
    nock.cleanAll();
    nock.enableNetConnect();
    restore();
    rmSync(directory, { recursive: true, force: true });
  });

  async function setup(options: Record<string, unknown> = {}) {
    const storage = await import('../../src/lib/persistent-auth-config.js');
    const { MCPOAuthProvider } = await import('../../src/lib/mcp-oauth-provider.js');
    const { default: open } = await import('open');
    const provider = new MCPOAuthProvider({ serverUrl, clientId: 'public-client', ...options });
    const hash = storage.generateServerUrlHash(serverUrl);
    return { provider, storage, hash, open: open as jest.Mock };
  }
  function discovery(overrides: Record<string, unknown> = {}, selectedIssuer = issuer) {
    nock('https://resource.example')
      .get('/.well-known/oauth-protected-resource/mcp')
      .reply(200, {
        resource: serverUrl,
        authorization_servers: [selectedIssuer],
        scopes_supported: ['read'],
      });
    return nock(selectedIssuer)
      .get('/.well-known/oauth-authorization-server')
      .reply(200, {
        issuer: selectedIssuer,
        authorization_endpoint: `${selectedIssuer}/authorize`,
        token_endpoint: `${selectedIssuer}/token`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        ...overrides,
      });
  }
  function exchange(scope = 'read', clientId = 'public-client') {
    return nock(issuer)
      .post(
        '/token',
        body =>
          body.grant_type === 'authorization_code' &&
          body.client_id === clientId &&
          body.resource === serverUrl
      )
      .reply(200, {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        token_type: 'Bearer',
        expires_in: 3600,
        scope,
      });
  }
  function browser(open: jest.Mock, extras: Record<string, unknown> = {}) {
    const replies: number[] = [];
    open.mockImplementation(async (value: unknown) => {
      const url = new URL(String(value));
      const response = await fetch(url.searchParams.get('redirect_uri')!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'fixture-code',
          state: url.searchParams.get('state'),
          ...extras,
        }),
      });
      replies.push(response.status);
    });
    return replies;
  }
  async function stored(
    context: Awaited<ReturnType<typeof setup>>,
    extra: Record<string, unknown> = {}
  ) {
    await context.storage.writeJsonFile(context.hash, 'tokens.json', {
      access_token: 'old-access',
      refresh_token: 'old-refresh',
      token_type: 'Bearer',
      issuer,
      scope: 'read',
      expires_in: 3600,
      obtained_at: Date.now(),
      ...extra,
    });
    await context.storage.writeClientInfo(context.hash, { client_id: 'public-client', issuer });
  }

  it('refreshes a rejected but locally unexpired token once for concurrent callers', async () => {
    const c = await setup();
    await stored(c);
    discovery();
    const renewal = nock(issuer)
      .post(
        '/token',
        body => body.grant_type === 'refresh_token' && body.refresh_token === 'old-refresh'
      )
      .delay(40)
      .reply(200, {
        access_token: 'renewed',
        refresh_token: 'rotated',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    await Promise.all([
      c.provider.authorize({ rejectedToken: 'old-access' }),
      c.provider.authorize({ rejectedToken: 'old-access' }),
      c.provider.authorize({ rejectedToken: 'old-access' }),
    ]);
    expect(renewal.isDone()).toBe(true);
    expect(c.open).not.toHaveBeenCalled();
    expect(await c.storage.readTokens(c.hash)).toMatchObject({
      access_token: 'renewed',
      refresh_token: 'rotated',
      issuer,
    });
  });

  it('reuses an already replaced token without deleting or refreshing it', async () => {
    const c = await setup();
    await stored(c, { access_token: 'newer' });
    await c.provider.authorize({ rejectedToken: 'older' });
    expect((await c.storage.readTokens(c.hash))?.access_token).toBe('newer');
    expect(c.open).not.toHaveBeenCalled();
  });

  it('rejects a changed issuer for a configured client before transmitting old credentials', async () => {
    const c = await setup();
    await stored(c, { expires_in: 1, obtained_at: 1 });
    discovery({}, 'https://new-issuer.example');
    const forbidden = nock('https://new-issuer.example').post('/token').reply(200, {});
    await expect(c.provider.authorize()).rejects.toMatchObject({ code: 'CLIENT_ISSUER_MISMATCH' });
    expect(forbidden.isDone()).toBe(false);
    expect(c.open).not.toHaveBeenCalled();
    expect((await c.storage.readTokens(c.hash))?.refresh_token).toBe('old-refresh');
  });

  it('migrates unbound expired credentials by login, never by sending their refresh token', async () => {
    const c = await setup();
    await stored(c, { issuer: undefined, expires_in: 1, obtained_at: 1 });
    discovery();
    const grant = exchange();
    browser(c.open);
    await c.provider.authorize();
    expect(grant.isDone()).toBe(true);
    expect(c.open).toHaveBeenCalledTimes(1);
    expect((await c.storage.readTokens(c.hash))?.issuer).toBe(issuer);
  });

  it.each([undefined, ['plain']])(
    'refuses authorization when PKCE S256 support is %p',
    async methods => {
      const c = await setup();
      discovery({ code_challenge_methods_supported: methods });
      await expect(c.provider.authorize()).rejects.toMatchObject({ code: 'PKCE_REQUIRED' });
      expect(c.open).not.toHaveBeenCalled();
    }
  );

  it.each([
    [true, 'https://wrong.example'],
    [true, undefined],
    [false, 'https://wrong.example'],
  ])(
    'rejects invalid issuer responses (advertised=%p, iss=%p) before exchange',
    async (advertised, responseIssuer) => {
      const c = await setup();
      discovery({ authorization_response_iss_parameter_supported: advertised });
      const replies = browser(c.open, responseIssuer ? { iss: responseIssuer } : {});
      const forbidden = exchange();
      await expect(c.provider.authorize()).rejects.toMatchObject({ code: 'INVALID_ISSUER' });
      expect(replies).toEqual([400]);
      expect(forbidden.isDone()).toBe(false);
    }
  );

  it('accepts matching issuer and accepts absence when not advertised', async () => {
    const c = await setup();
    discovery({ authorization_response_iss_parameter_supported: true });
    exchange();
    browser(c.open, { iss: issuer });
    await c.provider.authorize();
    expect((await c.storage.readTokens(c.hash))?.access_token).toBe('new-access');
  });

  it('ends a validated denial promptly without waiting for the callback timeout', async () => {
    const c = await setup();
    discovery({ authorization_response_iss_parameter_supported: true });
    browser(c.open, { code: undefined, error: 'access_denied', iss: issuer });
    await expect(c.provider.authorize()).rejects.toMatchObject({ code: 'AUTH_DENIED' });
    expect(await c.storage.readTokens(c.hash)).toBeNull();
  });

  it('registers native refresh support and replaces registrations bound to another issuer', async () => {
    const c = await setup({ clientId: undefined });
    await c.storage.writeClientInfo(c.hash, {
      client_id: 'old-client',
      issuer: 'https://old-issuer.example',
    });
    discovery({ registration_endpoint: `${issuer}/register` });
    const registration = nock(issuer)
      .post(
        '/register',
        body =>
          body.application_type === 'native' &&
          body.token_endpoint_auth_method === 'none' &&
          body.grant_types.includes('refresh_token')
      )
      .reply(201, { client_id: 'new-client' });
    exchange('read', 'new-client');
    browser(c.open);
    await c.provider.authorize();
    expect(registration.isDone()).toBe(true);
    expect(await c.storage.readClientInfo(c.hash)).toMatchObject({
      client_id: 'new-client',
      issuer,
      application_type: 'native',
      grant_types: ['authorization_code', 'refresh_token'],
    });
  });

  it.each([
    { client_id: 123 },
    { client_id: 'client', token_endpoint_auth_method: 'client_secret_basic' },
    { client_id: 'client', redirect_uris: ['https://untrusted.example/callback'] },
  ])('rejects unusable registration responses before opening consent: %p', async response => {
    const c = await setup({ clientId: undefined });
    discovery({ registration_endpoint: `${issuer}/register` });
    nock(issuer).post('/register').reply(201, response);
    await expect(c.provider.authorize()).rejects.toMatchObject({
      code: 'INVALID_REGISTRATION_RESPONSE',
    });
    expect(c.open).not.toHaveBeenCalled();
  });

  it('uses challenged scopes and metadata from the actual resource challenge', async () => {
    const c = await setup();
    nock('https://metadata.example')
      .get('/selected')
      .reply(200, { resource: serverUrl, authorization_servers: [issuer] });
    nock(issuer)
      .get('/.well-known/oauth-authorization-server')
      .reply(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
      });
    exchange('files:read');
    browser(c.open);
    await c.provider.authorize({
      challenge: {
        scheme: 'Bearer',
        resource_metadata: 'https://metadata.example/selected',
        scope: 'files:read',
      },
    });
    expect(new URL(String(c.open.mock.calls[0][0])).searchParams.get('scope')).toBe('files:read');
  });

  it('requests the union of earlier grants and additional challenged scopes', async () => {
    const c = await setup();
    await stored(c);
    discovery();
    exchange('read write');
    browser(c.open);
    await c.provider.authorize({
      scopes: ['write'],
      challenge: { scheme: 'Bearer', scope: 'write' },
    });
    expect(
      new Set(new URL(String(c.open.mock.calls[0][0])).searchParams.get('scope')!.split(' '))
    ).toEqual(new Set(['read', 'write']));
    expect((await c.storage.readTokens(c.hash))?.scope).toBe('read write');
  });

  it('preserves a pathless metadata resource verbatim in authorization and token requests', async () => {
    const root = 'https://resource.example';
    const c = await setup({ serverUrl: root });
    nock(root)
      .get('/.well-known/oauth-protected-resource')
      .reply(200, { resource: root, authorization_servers: [issuer] });
    nock(issuer)
      .get('/.well-known/oauth-authorization-server')
      .reply(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
      });
    const grant = nock(issuer)
      .post('/token', body => body.resource === root)
      .reply(200, { access_token: 'root-token', token_type: 'Bearer' });
    browser(c.open);
    await c.provider.authorize();
    expect(new URL(String(c.open.mock.calls[0][0])).searchParams.get('resource')).toBe(root);
    expect(grant.isDone()).toBe(true);
  });

  it('selects a free callback port when a saved registration port is occupied', async () => {
    const c = await setup();
    const { createServer } = await import('node:net');
    const { selectCallbackPort } = await import('../../src/lib/port-utils.js');
    const holder = createServer();
    await new Promise<void>(resolve => holder.listen(0, '127.0.0.1', resolve));
    const port = (holder.address() as { port: number }).port;
    try {
      await c.storage.writeClientInfo(c.hash, {
        client_id: 'public-client',
        issuer,
        redirect_uris: [`http://127.0.0.1:${port}/oauth/callback`],
      });
      expect(await selectCallbackPort(serverUrl)).not.toBe(port);
      expect(await selectCallbackPort(serverUrl, port)).toBe(port);
    } finally {
      await new Promise<void>(resolve => holder.close(() => resolve()));
    }
  });

  it('retries an older scope rejection with an already-upgraded pair without new consent', async () => {
    const c = await setup();
    await stored(c, { access_token: 'upgraded', scope: 'read write' });
    const { recoverOAuthAuthorization } = await import('../../src/lib/wordpress-api.js');
    const challenge = { scheme: 'Bearer', error: 'insufficient_scope', scope: 'write' };
    expect(await recoverOAuthAuthorization('Bearer old', challenge, 403)).toBe(true);
    expect(await recoverOAuthAuthorization('Bearer upgraded', challenge, 403)).toBe(false);
    expect(c.open).not.toHaveBeenCalled();
  });

  it('omits scope when neither the user nor protected metadata supplies scopes', async () => {
    const c = await setup();
    nock('https://resource.example')
      .get('/.well-known/oauth-protected-resource/mcp')
      .reply(200, { resource: serverUrl, authorization_servers: [issuer] });
    nock(issuer)
      .get('/.well-known/oauth-authorization-server')
      .reply(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
      });
    exchange();
    browser(c.open);
    await c.provider.authorize();
    expect(new URL(String(c.open.mock.calls[0][0])).searchParams.has('scope')).toBe(false);
  });

  it('fails explicitly if resource indicators are disabled', async () => {
    process.env.OAUTH_RESOURCE_INDICATOR = 'false';
    jest.resetModules();
    const c = await setup();
    discovery();
    await expect(c.provider.authorize()).rejects.toMatchObject({ code: 'RESOURCE_REQUIRED' });
    expect(c.open).not.toHaveBeenCalled();
  });

  it('rejects zero-lifetime tokens instead of treating them as non-expiring', async () => {
    const { isTokenValid } = await import('../../src/lib/persistent-auth-config.js');
    expect(
      isTokenValid({
        access_token: 'token',
        token_type: 'Bearer',
        obtained_at: Date.now(),
        expires_in: 0,
      }).isValid
    ).toBe(false);
  });

  it('isolates the implicit callback and ignores invalid state without consuming a valid callback', async () => {
    const { OAuthCallbackServer } = await import('../../src/lib/oauth-callback-server.js');
    const events = new EventEmitter();
    const received: unknown[] = [];
    events.on('oauth-code-received', value => received.push(value));
    const server = new OAuthCallbackServer(
      { port: 0, host: '127.0.0.1', serverUrlHash: 'callback-test', state: 'expected', issuer },
      events
    );
    await server.start();
    const address = (server as any).server.address();
    const origin = `http://127.0.0.1:${address.port}`;
    const post = (path: string, body: unknown, extra: Record<string, string> = {}) =>
      fetch(origin + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...extra },
        body: JSON.stringify(body),
      });
    try {
      expect((await post('/oauth/tokens', { access_token: 'injected' })).status).toBe(404);
      expect((await post('/oauth/callback', { code: 'wrong', state: 'wrong' })).status).toBe(400);
      expect(
        (
          await post(
            '/oauth/callback',
            { code: 'wrong-origin', state: 'expected' },
            { Origin: 'https://untrusted.example' }
          )
        ).status
      ).toBe(403);
      expect((await post('/oauth/callback', { code: 'valid', state: 'expected' })).status).toBe(
        200
      );
      expect(received).toEqual([{ code: 'valid', state: 'expected', iss: undefined }]);
      const page = await (await fetch(origin + '/oauth/callback')).text();
      expect(page).toContain('Authorization code received');
      expect(page).toContain('Token exchange may still fail');
    } finally {
      await server.stop();
    }
  });
});
