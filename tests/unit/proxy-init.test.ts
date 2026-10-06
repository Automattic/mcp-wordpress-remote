/**
 * Unit tests for proxy initialization precedence in doInitializeProxy().
 *
 * Guards two rules: an explicit proxy environment variable wins over
 * auto-detected macOS system proxies, and it applies without
 * USE_SYSTEM_PROXY, which only enables the macOS detection. The macOS
 * detector is injected so the logic is tested without shelling out to scutil.
 */

import { jest } from '@jest/globals';
import { mockEnv } from '../utils/test-helpers.js';

// Shape returned by the real detectMacOsProxy(); declared locally because the
// type is internal to the module under test.
type MacOsProxyInfo = {
  pacUrl: string | null;
  socks: { host: string; port: string } | null;
};

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

describe('doInitializeProxy precedence', () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    if (restoreEnv) restoreEnv();
  });

  it('explicit env proxy wins over a detected macOS system PAC', async () => {
    // A system PAC is available, but the explicit env proxy must win and its
    // scheme (socks5://, client-side DNS) must be honored verbatim.
    const detectMacOs = jest.fn<() => MacOsProxyInfo | null>(() => ({
      pacUrl: 'http://pac.example.com/proxy.pac',
      socks: null,
    }));
    restoreEnv = mockEnv({
      ...NO_PROXY_ENV,
      USE_SYSTEM_PROXY: 'true',
      SOCKS_PROXY: 'socks5://127.0.0.1:1080',
    });

    const proxy = await import('../../src/lib/proxy-utils.js');
    await proxy.initializeProxy(detectMacOs);

    expect(proxy.getProxyType()).toBe('env');
    // Explicit env proxy short-circuits system detection.
    expect(detectMacOs).not.toHaveBeenCalled();

    const agent = await proxy.getAgentForUrl('https://example.com');
    expect(agent?.constructor.name).toBe('SocksProxyAgent');
  });

  it('falls back to system proxy detection when no env proxy is set', async () => {
    const detectMacOs = jest.fn<() => MacOsProxyInfo | null>(() => ({
      pacUrl: null,
      socks: null,
    }));
    restoreEnv = mockEnv({ ...NO_PROXY_ENV, USE_SYSTEM_PROXY: 'true' });

    const proxy = await import('../../src/lib/proxy-utils.js');
    await proxy.initializeProxy(detectMacOs);

    // System detection runs only because no explicit env proxy was present.
    expect(detectMacOs).toHaveBeenCalledTimes(1);
    expect(proxy.getProxyType()).toBe('none');
  });

  it('falls back to the system SOCKS proxy when the PAC download does not finish in time', async () => {
    restoreEnv = mockEnv({ ...NO_PROXY_ENV, USE_SYSTEM_PROXY: 'true', PROXY_PAC_TIMEOUT_MS: '20' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(() => new Promise<Response>(() => {})) as typeof fetch;

    try {
      const proxy = await import('../../src/lib/proxy-utils.js');
      await proxy.initializeProxy(() => ({
        pacUrl: 'https://pac.example.com/proxy.pac',
        socks: { host: '127.0.0.1', port: '8080' },
      }));

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(proxy.getProxyType()).toBe('env');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('env proxies without USE_SYSTEM_PROXY', () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    if (restoreEnv) restoreEnv();
  });

  it('uses SOCKS_PROXY', async () => {
    const detectMacOs = jest.fn<() => MacOsProxyInfo | null>(() => null);
    restoreEnv = mockEnv({ ...NO_PROXY_ENV, SOCKS_PROXY: 'socks5h://127.0.0.1:8080' });

    const proxy = await import('../../src/lib/proxy-utils.js');
    await proxy.initializeProxy(detectMacOs);

    expect(proxy.getProxyType()).toBe('env');
    const agent = await proxy.getAgentForUrl('https://public-api.wordpress.com');
    expect(agent?.constructor.name).toBe('SocksProxyAgent');
  });

  it('uses HTTPS_PROXY', async () => {
    restoreEnv = mockEnv({ ...NO_PROXY_ENV, HTTPS_PROXY: 'http://127.0.0.1:3128' });

    const proxy = await import('../../src/lib/proxy-utils.js');
    await proxy.initializeProxy(() => null);

    const agent = await proxy.getAgentForUrl('https://public-api.wordpress.com');
    expect(agent?.constructor.name).toBe('HttpsProxyAgent');
  });

  it('skips the env proxy for hosts matching NO_PROXY', async () => {
    restoreEnv = mockEnv({
      ...NO_PROXY_ENV,
      SOCKS_PROXY: 'socks5h://127.0.0.1:8080',
      NO_PROXY: 'example.com',
    });

    const proxy = await import('../../src/lib/proxy-utils.js');
    await proxy.initializeProxy(() => null);

    expect(await proxy.getAgentForUrl('https://example.com')).toBeUndefined();
  });

  it('does not run macOS detection when no env proxy is set', async () => {
    const detectMacOs = jest.fn<() => MacOsProxyInfo | null>(() => ({
      pacUrl: null,
      socks: { host: '127.0.0.1', port: '8080' },
    }));
    restoreEnv = mockEnv(NO_PROXY_ENV);

    const proxy = await import('../../src/lib/proxy-utils.js');
    await proxy.initializeProxy(detectMacOs);

    expect(detectMacOs).not.toHaveBeenCalled();
    expect(proxy.getProxyType()).toBe('none');
  });
});
