/**
 * Unit tests for proxy initialization precedence in doInitializeProxy().
 *
 * Guards the rule that an explicit proxy environment variable wins over
 * auto-detected macOS system proxies. The macOS detector is injected so the
 * precedence logic is tested without shelling out to scutil.
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
    restoreEnv = mockEnv({ ...NO_PROXY_ENV, SOCKS_PROXY: 'socks5://127.0.0.1:1080' });

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
    restoreEnv = mockEnv(NO_PROXY_ENV);

    const proxy = await import('../../src/lib/proxy-utils.js');
    await proxy.initializeProxy(detectMacOs);

    // System detection runs only because no explicit env proxy was present.
    expect(detectMacOs).toHaveBeenCalledTimes(1);
    expect(proxy.getProxyType()).toBe('none');
  });

  it('refreshes proxy configuration after system settings change', async () => {
    restoreEnv = mockEnv(NO_PROXY_ENV);

    const proxy = await import('../../src/lib/proxy-utils.js');
    await proxy.initializeProxy(() => ({ pacUrl: null, socks: null }));

    expect(proxy.getProxyType()).toBe('none');

    await proxy.refreshProxy(() => ({
      pacUrl: null,
      socks: { host: '127.0.0.1', port: '8080' },
    }));

    expect(proxy.getProxyType()).toBe('env');
    const agent = await proxy.getAgentForUrl('https://example.com');
    expect(agent?.constructor.name).toBe('SocksProxyAgent');
  });

  it('coalesces concurrent refreshes', async () => {
    restoreEnv = mockEnv(NO_PROXY_ENV);

    const proxy = await import('../../src/lib/proxy-utils.js');
    await proxy.initializeProxy(() => ({ pacUrl: null, socks: null }));

    const detectMacOs = jest.fn<() => MacOsProxyInfo | null>(() => ({
      pacUrl: null,
      socks: { host: '127.0.0.1', port: '8080' },
    }));

    await Promise.all([proxy.refreshProxy(detectMacOs), proxy.refreshProxy(detectMacOs)]);

    expect(detectMacOs).toHaveBeenCalledTimes(1);
    expect(proxy.getProxyType()).toBe('env');
  });

  it('allows later refreshes after another system proxy change', async () => {
    restoreEnv = mockEnv(NO_PROXY_ENV);

    const proxy = await import('../../src/lib/proxy-utils.js');
    await proxy.initializeProxy(() => ({ pacUrl: null, socks: null }));

    const detectMacOs = jest
      .fn<() => MacOsProxyInfo | null>()
      .mockReturnValueOnce({
        pacUrl: null,
        socks: { host: '127.0.0.1', port: '8080' },
      })
      .mockReturnValueOnce({ pacUrl: null, socks: null });

    await proxy.refreshProxy(detectMacOs);
    expect(proxy.getProxyType()).toBe('env');

    await proxy.refreshProxy(detectMacOs);
    expect(proxy.getProxyType()).toBe('none');
    expect(detectMacOs).toHaveBeenCalledTimes(2);
  });

  it('bounds PAC initialization and swaps configuration only after it settles', async () => {
    restoreEnv = mockEnv({ ...NO_PROXY_ENV, PROXY_PAC_TIMEOUT_MS: '20' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(() => new Promise<Response>(() => {})) as typeof fetch;

    try {
      const proxy = await import('../../src/lib/proxy-utils.js');
      await proxy.initializeProxy(() => ({
        pacUrl: null,
        socks: { host: '127.0.0.1', port: '8080' },
      }));

      const refresh = proxy.refreshProxy(() => ({
        pacUrl: 'https://pac.example.com/proxy.pac',
        socks: null,
      }));

      // Refresh waits for a complete replacement; the working configuration
      // remains available while PAC loading is still pending.
      expect(proxy.getProxyType()).toBe('env');

      await refresh;

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(proxy.getProxyType()).toBe('none');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
