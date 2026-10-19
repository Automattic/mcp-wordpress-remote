import nock from 'nock';
import { mockEnv } from '../utils/test-helpers.js';

describe('MCP OAuth discovery and endpoint trust', () => {
  const resource = 'https://resource.example/mcp';
  const issuer = 'https://issuer.example/tenant';
  let restore: () => void;
  const metadata = () => ({
    issuer,
    authorization_endpoint: 'https://issuer.example/authorize',
    token_endpoint: 'https://issuer.example/token',
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
  });

  beforeEach(() => {
    restore = mockEnv({
      WP_API_URL: resource,
      CUSTOM_HEADERS: '',
      USE_SYSTEM_PROXY: 'false',
      SOCKS_PROXY: '',
      LOG_FILE: '',
    });
    jest.resetModules();
    nock.disableNetConnect();
  });
  afterEach(() => {
    restore();
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('uses standard challenge parameters, escaped values and mixed schemes', async () => {
    const { parseWWWAuthenticateHeader } = await import('../../src/lib/mcp-oauth-utils.js');
    expect(
      parseWWWAuthenticateHeader(
        'Basic realm="front", bEaReR resource_metadata="https://resource.example/meta", scope="files:read files:write", error=insufficient_scope'
      )
    ).toMatchObject({
      scheme: 'Bearer',
      resource_metadata: 'https://resource.example/meta',
      scope: 'files:read files:write',
      error: 'insufficient_scope',
    });
    expect(parseWWWAuthenticateHeader('Bearer realm="a\\"b"').realm).toBe('a"b');
  });

  it('uses challenged metadata without probing well-known locations', async () => {
    const { discoverProtectedResourceMetadata } = await import('../../src/lib/mcp-oauth-utils.js');
    const scope = nock('https://metadata.example')
      .get('/chosen')
      .reply(200, { resource, authorization_servers: [issuer] });
    expect(
      (await discoverProtectedResourceMetadata(resource, 'https://metadata.example/chosen'))
        .resource
    ).toBe(resource);
    expect(scope.isDone()).toBe(true);
  });

  it('tries path-specific protected metadata before the root fallback', async () => {
    const { discoverProtectedResourceMetadata } = await import('../../src/lib/mcp-oauth-utils.js');
    const scope = nock('https://resource.example')
      .get('/.well-known/oauth-protected-resource/mcp')
      .reply(404)
      .get('/.well-known/oauth-protected-resource')
      .reply(200, { resource: 'https://resource.example', authorization_servers: [issuer] });
    expect((await discoverProtectedResourceMetadata(resource)).resource).toBe(
      'https://resource.example'
    );
    expect(scope.isDone()).toBe(true);
  });

  it('rejects metadata for another protected resource without falling back', async () => {
    const { discoverProtectedResourceMetadata } = await import('../../src/lib/mcp-oauth-utils.js');
    nock('https://resource.example')
      .get('/.well-known/oauth-protected-resource/mcp')
      .reply(200, { resource: 'https://other.example', authorization_servers: [issuer] });
    await expect(discoverProtectedResourceMetadata(resource)).rejects.toMatchObject({
      code: 'INVALID_RESOURCE_METADATA',
    });
  });

  it.each([
    ['missing resource', { authorization_servers: [issuer] }],
    ['empty authorization servers', { resource, authorization_servers: [] }],
    [
      'invalid authorization servers',
      { resource, authorization_servers: 'https://issuer.example' },
    ],
  ])('rejects malformed protected metadata: %s', async (_name, body) => {
    const { discoverProtectedResourceMetadata } = await import('../../src/lib/mcp-oauth-utils.js');
    nock('https://resource.example')
      .get('/.well-known/oauth-protected-resource/mcp')
      .reply(200, body);
    await expect(discoverProtectedResourceMetadata(resource)).rejects.toThrow();
  });

  it('tries tenant OAuth, inserted OIDC and appended OIDC discovery in order', async () => {
    const { discoverAuthorizationServerMetadata } = await import(
      '../../src/lib/mcp-oauth-utils.js'
    );
    const scope = nock('https://issuer.example')
      .get('/.well-known/oauth-authorization-server/tenant')
      .reply(404)
      .get('/.well-known/openid-configuration/tenant')
      .reply(404)
      .get('/tenant/.well-known/openid-configuration')
      .reply(200, metadata());
    expect((await discoverAuthorizationServerMetadata(issuer)).issuer).toBe(issuer);
    expect(scope.isDone()).toBe(true);
  });

  it('supports root OIDC fallback', async () => {
    const { discoverAuthorizationServerMetadata } = await import(
      '../../src/lib/mcp-oauth-utils.js'
    );
    nock('https://issuer.example')
      .get('/.well-known/oauth-authorization-server')
      .reply(404)
      .get('/.well-known/openid-configuration')
      .reply(200, { ...metadata(), issuer: 'https://issuer.example' });
    expect((await discoverAuthorizationServerMetadata('https://issuer.example')).issuer).toBe(
      'https://issuer.example'
    );
  });

  it.each(['https://other.example', 'https://issuer.example/tenant/'])(
    'rejects a mismatched metadata issuer %s',
    async mismatched => {
      const { discoverAuthorizationServerMetadata } = await import(
        '../../src/lib/mcp-oauth-utils.js'
      );
      nock('https://issuer.example')
        .get('/.well-known/oauth-authorization-server/tenant')
        .reply(200, { ...metadata(), issuer: mismatched });
      await expect(discoverAuthorizationServerMetadata(issuer)).rejects.toMatchObject({
        code: 'INVALID_METADATA',
      });
    }
  );

  it('does not use fallback metadata after a transient server failure', async () => {
    const { discoverAuthorizationServerMetadata } = await import(
      '../../src/lib/mcp-oauth-utils.js'
    );
    nock('https://issuer.example').get('/.well-known/oauth-authorization-server/tenant').reply(503);
    await expect(discoverAuthorizationServerMetadata(issuer)).rejects.toMatchObject({
      code: 'METADATA_DISCOVERY_FAILED',
    });
  });

  it('does not send configured credentials to a different authorization origin', async () => {
    process.env.CUSTOM_HEADERS = JSON.stringify({
      Authorization: 'Bearer fixture-secret',
      'X-API-Key': 'fixture-key',
    });
    const { discoverAuthorizationServerMetadata } = await import(
      '../../src/lib/mcp-oauth-utils.js'
    );
    let headers: Record<string, unknown> = {};
    nock('https://issuer.example')
      .get('/.well-known/oauth-authorization-server/tenant')
      .reply(function () {
        headers = this.req.headers;
        return [200, metadata()];
      });
    await discoverAuthorizationServerMetadata(issuer);
    expect(headers.authorization).toBeUndefined();
    expect(headers['x-api-key']).toBeUndefined();
  });

  it('preserves explicitly configured same-origin discovery credentials', async () => {
    process.env.CUSTOM_HEADERS = JSON.stringify({ 'X-API-Key': 'fixture-key' });
    const { discoverProtectedResourceMetadata } = await import('../../src/lib/mcp-oauth-utils.js');
    const scope = nock('https://resource.example')
      .get('/.well-known/oauth-protected-resource/mcp')
      .matchHeader('X-API-Key', 'fixture-key')
      .reply(200, { resource, authorization_servers: [issuer] });
    await discoverProtectedResourceMetadata(resource);
    expect(scope.isDone()).toBe(true);
  });

  it.each([
    'http://remote.example/token',
    'https://user:secret@issuer.example/token',
    'https://issuer.example/token#fragment',
    'javascript:alert(1)',
  ])('refuses unsafe endpoint %s before sending credentials', async endpoint => {
    const { exchangeAuthorizationCode } = await import('../../src/lib/mcp-oauth-utils.js');
    await expect(
      exchangeAuthorizationCode(
        endpoint,
        'fixture-code',
        'http://127.0.0.1/callback',
        'client',
        'verifier'
      )
    ).rejects.toThrow();
  });

  it('rejects redirects rather than forwarding a code to another destination', async () => {
    const { exchangeAuthorizationCode } = await import('../../src/lib/mcp-oauth-utils.js');
    nock('https://issuer.example')
      .post('/token')
      .reply(307, '', { Location: 'http://remote.example/token' });
    await expect(
      exchangeAuthorizationCode(
        'https://issuer.example/token',
        'fixture-code',
        'http://127.0.0.1/callback',
        'client',
        'verifier'
      )
    ).rejects.toThrow();
  });

  it('allows HTTP only for loopback development endpoints', async () => {
    const { exchangeAuthorizationCode } = await import('../../src/lib/mcp-oauth-utils.js');
    nock('http://127.0.0.1:12345')
      .post('/token')
      .reply(200, { access_token: 'fixture-token', token_type: 'Bearer' });
    expect(
      (
        await exchangeAuthorizationCode(
          'http://127.0.0.1:12345/token',
          'code',
          'http://127.0.0.1/callback',
          'client',
          'verifier'
        )
      ).access_token
    ).toBe('fixture-token');
  });

  it('keeps authorization endpoint query parameters and rejects unsupported token types', async () => {
    const { buildAuthorizationUrl, exchangeAuthorizationCode } = await import(
      '../../src/lib/mcp-oauth-utils.js'
    );
    const url = new URL(
      buildAuthorizationUrl(
        'https://issuer.example/authorize?tenant=one',
        'client',
        'http://127.0.0.1/callback',
        ['read'],
        'state',
        'challenge',
        resource
      )
    );
    expect(url.searchParams.get('tenant')).toBe('one');
    expect(url.searchParams.get('resource')).toBe(resource);
    nock('https://issuer.example')
      .post('/token')
      .reply(200, { access_token: 'fixture-token', token_type: 'DPoP' });
    await expect(
      exchangeAuthorizationCode(
        'https://issuer.example/token',
        'code',
        'http://127.0.0.1/callback',
        'client',
        'verifier'
      )
    ).rejects.toThrow('Unsupported token type');
  });
});
