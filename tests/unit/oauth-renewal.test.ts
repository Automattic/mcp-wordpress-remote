import { jest } from '@jest/globals';
import nock from 'nock';
import fs from 'node:fs/promises';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockEnv } from '../utils/test-helpers.js';

describe('OAuth renewal', () => {
  const origin = 'https://example.com';
  const serverUrl = `${origin}/mcp`;
  let directory: string;
  let restore: () => void;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'oauth-renewal-'));
    restore = mockEnv({
      WP_MCP_CONFIG_DIR: directory,
      WP_API_URL: serverUrl,
      OAUTH_TIMEOUT_MS: '1000',
      LOG_LEVEL: '0',
      LOG_FILE: '',
      USE_SYSTEM_PROXY: 'false',
      SOCKS_PROXY: '',
    });
    jest.resetModules();
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
    restore();
    rmSync(directory, { recursive: true, force: true });
  });

  async function setup() {
    const storage = await import('../../src/lib/persistent-auth-config.js');
    const { MCPOAuthProvider } = await import('../../src/lib/mcp-oauth-provider.js');
    const { default: open } = await import('open');
    const hash = storage.generateServerUrlHash(serverUrl);
    const expired = {
      access_token: 'expired-access',
      refresh_token: 'usable-refresh',
      token_type: 'Bearer',
      expires_in: 1,
      obtained_at: Date.now() - 120000,
    };
    await storage.writeJsonFile(hash, 'tokens.json', expired);
    await storage.writeClientInfo(hash, { client_id: 'saved-client' });
    const provider = new MCPOAuthProvider({ serverUrl });
    return { storage, hash, expired, provider, open };
  }

  function discovery() {
    return nock(origin)
      .get('/.well-known/oauth-protected-resource')
      .reply(200, { resource: serverUrl, authorization_servers: [origin] })
      .get('/.well-known/oauth-authorization-server')
      .reply(200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        response_types_supported: ['code'],
        token_endpoint_auth_methods_supported: ['none'],
      });
  }

  it('refreshes once for concurrent calls and persists the rotated pair without login', async () => {
    const { storage, hash, provider, open } = await setup();
    const metadata = discovery();
    const refresh = nock(origin)
      .post(
        '/token',
        body =>
          body.grant_type === 'refresh_token' &&
          body.client_id === 'saved-client' &&
          body.refresh_token === 'usable-refresh' &&
          body.resource === serverUrl
      )
      .delay(50)
      .reply(200, {
        access_token: 'renewed-access',
        refresh_token: 'rotated-refresh',
        token_type: 'Bearer',
        expires_in: 3600,
      });

    await Promise.all([provider.authorize(), provider.authorize(), provider.authorize()]);

    expect(metadata.isDone()).toBe(true);
    expect(refresh.isDone()).toBe(true);
    expect(await storage.readTokens(hash)).toMatchObject({
      access_token: 'renewed-access',
      refresh_token: 'rotated-refresh',
    });
    expect(open).not.toHaveBeenCalled();
  });

  it('retains the refresh token when the server does not rotate it', async () => {
    const { storage, hash, provider, open } = await setup();
    discovery();
    nock(origin)
      .post('/token')
      .reply(200, { access_token: 'renewed-access', token_type: 'Bearer', expires_in: 3600 });
    await provider.authorize();
    expect((await storage.readTokens(hash))?.refresh_token).toBe('usable-refresh');
    expect(open).not.toHaveBeenCalled();
  });

  it('preserves credentials and does not start login on a transient refresh failure', async () => {
    const { storage, hash, expired, provider, open } = await setup();
    discovery();
    nock(origin).post('/token').reply(503, { error: 'server_error' });
    await expect(provider.authorize()).rejects.toThrow();
    expect(await storage.readTokens(hash)).toEqual(expired);
    expect(open).not.toHaveBeenCalled();
  });

  it('falls back to one login only after the refresh token is rejected', async () => {
    const { storage, hash, provider } = await setup();
    discovery();
    nock(origin).post('/token').reply(400, { error: 'invalid_grant' });
    const fresh = {
      access_token: 'fresh-access',
      refresh_token: 'fresh-refresh',
      obtained_at: Date.now(),
      expires_in: 3600,
      token_type: 'Bearer',
    };
    const login = jest
      .spyOn(provider as any, 'performAuthorization')
      .mockImplementation(async () => {
        await storage.writeTokens(hash, fresh);
        return fresh;
      });
    await Promise.all([provider.authorize(), provider.authorize()]);
    expect(login).toHaveBeenCalledTimes(1);
    expect((await storage.readTokens(hash))?.access_token).toBe('fresh-access');
  });

  it('bounds the wait for another process without starting login', async () => {
    const { storage, hash, expired, open } = await setup();
    const { MCPOAuthProvider } = await import('../../src/lib/mcp-oauth-provider.js');
    const { default: lockfile } = await import('proper-lockfile');
    const release = await lockfile.lock(storage.getConfigFilePath(hash, 'oauth'), {
      realpath: false,
    });
    try {
      const provider = new MCPOAuthProvider({ serverUrl, timeout: 50 });
      await expect(provider.authorize()).rejects.toMatchObject({ code: 'LOCK_TIMEOUT' });
      expect(await storage.readTokens(hash)).toEqual(expired);
      expect(open).not.toHaveBeenCalled();
    } finally {
      await release();
    }
  });

  it('does not replace the old credential file if an atomic save fails', async () => {
    const { storage, hash, expired } = await setup();
    jest.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk failure'));
    await expect(
      storage.writeTokens(hash, { ...expired, access_token: 'new-access' })
    ).rejects.toThrow('disk failure');
    expect(await storage.readTokens(hash)).toEqual(expired);
    expect(readdirSync(storage.getConfigDir()).some(file => file.endsWith('.tmp'))).toBe(false);
  });
});
