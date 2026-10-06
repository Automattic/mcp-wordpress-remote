/**
 * Unit tests for proxyFetch() routing.
 *
 * Guards the rule that an env proxy routes requests without USE_SYSTEM_PROXY.
 * node-fetch is mocked because proxied requests go through it with an agent.
 */

import { jest } from '@jest/globals';
import { mockEnv } from '../utils/test-helpers.js';

const mockNodeFetch = jest.fn(async () => new Response('proxied'));
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

  it('connects directly when no env proxy is set', async () => {
    restoreEnv = mockEnv(NO_PROXY_ENV);

    const { setupFetchPolyfill, proxyFetch } = await import('../../src/lib/fetch-utils.js');
    await setupFetchPolyfill();
    await proxyFetch('https://public-api.wordpress.com/wpcom/v2/mcp/v2');

    expect(mockNodeFetch).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
