/**
 * Unit tests for proxyFetch() routing.
 *
 * Guards the rule that an env proxy routes requests without USE_SYSTEM_PROXY, and that
 * proxied responses reach callers as native Responses.
 * node-fetch is mocked because proxied requests go through it with an agent; the mocks
 * return node-fetch's shape (its own class, with a Node stream body).
 */

import { jest } from '@jest/globals';
import { Readable } from 'node:stream';
import { InvalidGrantError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { parseErrorResponse } from '@modelcontextprotocol/sdk/client/auth.js';
import { mockEnv } from '../utils/test-helpers.js';

const nodeFetchResponse = (status: number, text: string) => ({
  ok: status < 400,
  status,
  statusText: '',
  headers: new Headers({ 'Content-Type': 'application/json' }),
  body: Readable.from([Buffer.from(text)]),
});
const mockNodeFetch = jest.fn(async () => nodeFetchResponse(200, 'proxied'));
jest.mock('node-fetch', () => ({ __esModule: true, default: mockNodeFetch }));

const NO_PROXY_ENV = {
  SOCKS_PROXY: '',
  socks_proxy: '',
  HTTPS_PROXY: '',
  https_proxy: '',
  ALL_PROXY: '',
  all_proxy: '',
  HTTP_PROXY: '',
  http_proxy: '',
  NO_PROXY: '',
  no_proxy: '',
  USE_SYSTEM_PROXY: '',
};

describe('proxyFetch', () => {
  let restoreEnv: () => void;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    jest.resetModules();
    mockNodeFetch.mockClear();
    globalThis.fetch = jest.fn(async () => new Response('direct')) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (restoreEnv) restoreEnv();
  });

  it('routes through SOCKS_PROXY when USE_SYSTEM_PROXY is unset', async () => {
    restoreEnv = mockEnv({ ...NO_PROXY_ENV, SOCKS_PROXY: 'socks5h://127.0.0.1:8080' });

    const { setupFetchPolyfill, proxyFetch } = await import('../../src/lib/fetch-utils.js');
    await setupFetchPolyfill();
    await proxyFetch('https://public-api.wordpress.com/wpcom/v2/mcp/v2');

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mockNodeFetch).toHaveBeenCalledTimes(1);
    const init = mockNodeFetch.mock.calls[0] as unknown as [string, { agent?: object }];
    expect(init[1].agent?.constructor.name).toBe('SocksProxyAgent');
  });

  it('returns a native Response, so the SDK can read a proxied OAuth error', async () => {
    restoreEnv = mockEnv({ ...NO_PROXY_ENV, SOCKS_PROXY: 'socks5h://127.0.0.1:8080' });
    mockNodeFetch.mockImplementationOnce(async () =>
      nodeFetchResponse(400, '{"error":"invalid_grant"}')
    );

    const { setupFetchPolyfill, proxyFetch } = await import('../../src/lib/fetch-utils.js');
    await setupFetchPolyfill();
    const response = await proxyFetch('https://public-api.wordpress.com/oauth2-1/token');

    expect(await parseErrorResponse(response)).toBeInstanceOf(InvalidGrantError);
  });

  it('connects directly when no env proxy is set', async () => {
    restoreEnv = mockEnv(NO_PROXY_ENV);

    const { setupFetchPolyfill, proxyFetch } = await import('../../src/lib/fetch-utils.js');
    await setupFetchPolyfill();
    await proxyFetch('https://public-api.wordpress.com/wpcom/v2/mcp/v2');

    expect(mockNodeFetch).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
