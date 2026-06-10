/**
 * Unit tests for MCPOAuthProvider client registration
 *
 * Regression coverage for the orphaned-client bug: the provider must reuse a
 * persisted DCR registration instead of minting a brand-new client on every
 * connect attempt. See ensureClientRegistration() in mcp-oauth-provider.ts.
 */

import { jest } from '@jest/globals';
import nock from 'nock';
import tmp from 'tmp';
import fsSync from 'fs';
import { mockEnv } from '../utils/test-helpers.js';

// Avoid ESM issues by stubbing the browser-opening dependency.
jest.unstable_mockModule('open', () => ({
  default: jest.fn().mockImplementation(() => Promise.resolve()),
}));

describe('MCPOAuthProvider client registration', () => {
  const origin = 'https://example.com';
  const serverUrl = `${origin}/`;
  const registrationPath = '/oauth/register';
  const registrationEndpoint = `${origin}${registrationPath}`;
  let tempDir: string;
  let restoreEnv: () => void;

  beforeEach(() => {
    tempDir = tmp.dirSync({ unsafeCleanup: true }).name;
    restoreEnv = mockEnv({
      WP_MCP_CONFIG_DIR: tempDir,
      WP_API_URL: serverUrl,
      OAUTH_ENABLED: 'true',
      OAUTH_DYNAMIC_REGISTRATION: 'true',
    });
    jest.resetModules();
    nock.cleanAll();
    // Fail fast: any request without a matching interceptor throws instead of
    // attempting a real connection to example.com.
    nock.disableNetConnect();
  });

  afterEach(() => {
    if (restoreEnv) restoreEnv();
    nock.cleanAll();
    nock.enableNetConnect();
    if (fsSync.existsSync(tempDir)) {
      fsSync.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  async function loadModules() {
    const { MCPOAuthProvider } = await import('../../src/lib/mcp-oauth-provider.js');
    const { generateServerUrlHash, writeClientInfo, readClientInfo, ensureConfigDir, getConfigFilePath } =
      await import('../../src/lib/persistent-auth-config.js');
    return {
      MCPOAuthProvider,
      generateServerUrlHash,
      writeClientInfo,
      readClientInfo,
      ensureConfigDir,
      getConfigFilePath,
    };
  }

  function buildProvider(MCPOAuthProvider: any) {
    const provider = new MCPOAuthProvider({ serverUrl, scopes: ['read', 'write'] });
    // ensureClientRegistration() is reached after discovery in the real flow;
    // inject the discovered metadata directly to isolate the registration step.
    (provider as any).authServerMetadata = { registration_endpoint: registrationEndpoint };
    return provider;
  }

  it('reuses a stored client_id and does not call /register', async () => {
    const { MCPOAuthProvider, generateServerUrlHash, writeClientInfo } = await loadModules();
    const hash = generateServerUrlHash(serverUrl);
    await writeClientInfo(hash, { client_id: 'stored-client-123' });

    // Any hit to the registration endpoint should fail the test.
    const scope = nock(origin).post(registrationPath).reply(201, { client_id: 'must-not-be-used' });

    const provider = buildProvider(MCPOAuthProvider);
    await (provider as any).ensureClientRegistration();

    expect(scope.isDone()).toBe(false); // /register was never called
    expect(provider.getConfig().clientId).toBe('stored-client-123');
  });

  it('registers exactly once and persists the result when no client is stored', async () => {
    const { MCPOAuthProvider, generateServerUrlHash, readClientInfo } = await loadModules();
    let registerCalls = 0;
    nock(origin)
      .post(registrationPath)
      .reply(201, () => {
        registerCalls++;
        return { client_id: 'new-client-456' };
      });

    const provider = buildProvider(MCPOAuthProvider);
    await (provider as any).ensureClientRegistration();

    expect(registerCalls).toBe(1); // exactly one /register call, not merely "at least one"
    expect(provider.getConfig().clientId).toBe('new-client-456');

    const hash = generateServerUrlHash(serverUrl);
    const persisted = await readClientInfo(hash);
    expect(persisted?.client_id).toBe('new-client-456');
  });

  it('falls through to registration when stored client_info is corrupt (empty client_id)', async () => {
    const { MCPOAuthProvider, generateServerUrlHash, readClientInfo, ensureConfigDir, getConfigFilePath } =
      await loadModules();
    await ensureConfigDir();
    const hash = generateServerUrlHash(serverUrl);
    // Structurally valid JSON but an unusable client_id — must not be promoted.
    fsSync.writeFileSync(getConfigFilePath(hash, 'client_info.json'), JSON.stringify({ client_id: '' }));

    let registerCalls = 0;
    nock(origin)
      .post(registrationPath)
      .reply(201, () => {
        registerCalls++;
        return { client_id: 'fresh-after-corrupt' };
      });

    const provider = buildProvider(MCPOAuthProvider);
    await (provider as any).ensureClientRegistration();

    expect(registerCalls).toBe(1); // the empty client_id did not short-circuit registration
    expect(provider.getConfig().clientId).toBe('fresh-after-corrupt');
    const persisted = await readClientInfo(hash);
    expect(persisted?.client_id).toBe('fresh-after-corrupt');
  });

  it('reuses the stored client even when tokens are absent/expired (re-auth, not re-register)', async () => {
    const { MCPOAuthProvider, generateServerUrlHash, writeClientInfo } = await loadModules();
    const hash = generateServerUrlHash(serverUrl);
    await writeClientInfo(hash, { client_id: 'stored-client-789' });

    // No tokens are persisted, mimicking expiry/first-run-after-reauth. The
    // provider must still reuse the registration rather than create a new one.
    const scope = nock(origin).post(registrationPath).reply(201, { client_id: 'must-not-be-used' });

    const provider = buildProvider(MCPOAuthProvider);
    await (provider as any).ensureClientRegistration();

    expect(scope.isDone()).toBe(false);
    expect(provider.getConfig().clientId).toBe('stored-client-789');
  });

  it('skips both reuse and registration when a client_id is explicitly provided', async () => {
    const { MCPOAuthProvider } = await loadModules();
    const scope = nock(origin).post(registrationPath).reply(201, { client_id: 'must-not-be-used' });

    const provider = new MCPOAuthProvider({ serverUrl, clientId: 'env-client', scopes: ['read'] });
    (provider as any).authServerMetadata = { registration_endpoint: registrationEndpoint };

    await (provider as any).ensureClientRegistration();

    expect(scope.isDone()).toBe(false);
    expect(provider.getConfig().clientId).toBe('env-client');
  });
});
