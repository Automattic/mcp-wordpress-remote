/**
 * Unit tests for proxy utilities
 */

import { isSocksProxy, shouldBypassProxy, detectEnvProxy } from '../../src/lib/proxy-utils.js';
import { mockEnv } from '../utils/test-helpers.js';

describe('Proxy Utilities', () => {
  let restoreEnv: () => void;

  afterEach(() => {
    if (restoreEnv) {
      restoreEnv();
    }
  });

  describe('isSocksProxy', () => {
    it('should return true for lowercase socks URLs', () => {
      expect(isSocksProxy('socks://127.0.0.1:1080')).toBe(true);
      expect(isSocksProxy('socks4://127.0.0.1:1080')).toBe(true);
      expect(isSocksProxy('socks5://127.0.0.1:1080')).toBe(true);
    });

    it('should return true for uppercase SOCKS URLs (case-insensitive)', () => {
      expect(isSocksProxy('SOCKS://127.0.0.1:1080')).toBe(true);
      expect(isSocksProxy('SOCKS5://127.0.0.1:1080')).toBe(true);
      expect(isSocksProxy('Socks5://127.0.0.1:1080')).toBe(true);
    });

    it('should return false for HTTP proxy URLs', () => {
      expect(isSocksProxy('http://proxy.example.com:8080')).toBe(false);
      expect(isSocksProxy('https://proxy.example.com:8080')).toBe(false);
    });

    it('should return false for non-URL strings', () => {
      expect(isSocksProxy('proxy.example.com:8080')).toBe(false);
      expect(isSocksProxy('')).toBe(false);
    });
  });

  describe('shouldBypassProxy', () => {
    it('should return false when NO_PROXY is not set', () => {
      restoreEnv = mockEnv({});
      expect(shouldBypassProxy('https://example.com')).toBe(false);
    });

    it('should match exact hostname', () => {
      restoreEnv = mockEnv({ NO_PROXY: 'example.com' });
      expect(shouldBypassProxy('https://example.com/path')).toBe(true);
      expect(shouldBypassProxy('https://other.com')).toBe(false);
    });

    it('should match domain suffix without leading dot', () => {
      restoreEnv = mockEnv({ NO_PROXY: 'example.com' });
      expect(shouldBypassProxy('https://api.example.com')).toBe(true);
      expect(shouldBypassProxy('https://deep.api.example.com')).toBe(true);
      expect(shouldBypassProxy('https://notexample.com')).toBe(false);
    });

    it('should match domain suffix with leading dot', () => {
      restoreEnv = mockEnv({ NO_PROXY: '.example.com' });
      expect(shouldBypassProxy('https://api.example.com')).toBe(true);
      expect(shouldBypassProxy('https://example.com')).toBe(false); // exact match fails with leading dot
    });

    it('should handle wildcard (*) to bypass all', () => {
      restoreEnv = mockEnv({ NO_PROXY: '*' });
      expect(shouldBypassProxy('https://anything.com')).toBe(true);
      expect(shouldBypassProxy('https://another.org')).toBe(true);
    });

    it('should handle multiple comma-separated domains', () => {
      restoreEnv = mockEnv({ NO_PROXY: 'localhost,example.com,.internal.net' });
      expect(shouldBypassProxy('https://localhost')).toBe(true);
      expect(shouldBypassProxy('https://api.example.com')).toBe(true);
      expect(shouldBypassProxy('https://app.internal.net')).toBe(true);
      expect(shouldBypassProxy('https://external.com')).toBe(false);
    });

    it('should handle lowercase no_proxy env var', () => {
      restoreEnv = mockEnv({ no_proxy: 'example.com' });
      expect(shouldBypassProxy('https://example.com')).toBe(true);
    });

    it('should be case-insensitive for hostnames', () => {
      restoreEnv = mockEnv({ NO_PROXY: 'EXAMPLE.COM' });
      expect(shouldBypassProxy('https://example.com')).toBe(true);
      expect(shouldBypassProxy('https://Example.Com')).toBe(true);
    });

    it('should return false for invalid URLs', () => {
      restoreEnv = mockEnv({ NO_PROXY: 'example.com' });
      expect(shouldBypassProxy('not-a-valid-url')).toBe(false);
      expect(shouldBypassProxy('')).toBe(false);
    });

    it('should handle whitespace in NO_PROXY', () => {
      restoreEnv = mockEnv({ NO_PROXY: ' example.com , other.com ' });
      expect(shouldBypassProxy('https://example.com')).toBe(true);
      expect(shouldBypassProxy('https://other.com')).toBe(true);
    });
  });

  describe('detectEnvProxy', () => {
    it('should return null when no proxy env vars are set', () => {
      restoreEnv = mockEnv({});
      expect(detectEnvProxy()).toBeNull();
    });

    it('should detect SOCKS_PROXY with socks type', () => {
      restoreEnv = mockEnv({ SOCKS_PROXY: 'socks5://127.0.0.1:1080' });
      expect(detectEnvProxy()).toEqual({
        url: 'socks5://127.0.0.1:1080',
        type: 'socks',
      });
    });

    it('should detect lowercase socks_proxy', () => {
      restoreEnv = mockEnv({ socks_proxy: 'socks5://127.0.0.1:1080' });
      expect(detectEnvProxy()).toEqual({
        url: 'socks5://127.0.0.1:1080',
        type: 'socks',
      });
    });

    it('should detect HTTPS_PROXY with http type', () => {
      restoreEnv = mockEnv({ HTTPS_PROXY: 'http://proxy.example.com:8080' });
      expect(detectEnvProxy()).toEqual({
        url: 'http://proxy.example.com:8080',
        type: 'http',
      });
    });

    it('should detect HTTPS_PROXY with socks:// as socks type', () => {
      restoreEnv = mockEnv({ HTTPS_PROXY: 'socks5://127.0.0.1:1080' });
      expect(detectEnvProxy()).toEqual({
        url: 'socks5://127.0.0.1:1080',
        type: 'socks',
      });
    });

    it('should detect uppercase SOCKS URL in HTTPS_PROXY (case-insensitive)', () => {
      restoreEnv = mockEnv({ HTTPS_PROXY: 'SOCKS5://127.0.0.1:1080' });
      expect(detectEnvProxy()).toEqual({
        url: 'SOCKS5://127.0.0.1:1080',
        type: 'socks',
      });
    });

    it('should detect ALL_PROXY', () => {
      restoreEnv = mockEnv({ ALL_PROXY: 'http://proxy.example.com:8080' });
      expect(detectEnvProxy()).toEqual({
        url: 'http://proxy.example.com:8080',
        type: 'http',
      });
    });

    it('should detect HTTP_PROXY', () => {
      restoreEnv = mockEnv({ HTTP_PROXY: 'http://proxy.example.com:8080' });
      expect(detectEnvProxy()).toEqual({
        url: 'http://proxy.example.com:8080',
        type: 'http',
      });
    });

    it('should prioritize SOCKS_PROXY over HTTPS_PROXY', () => {
      restoreEnv = mockEnv({
        SOCKS_PROXY: 'socks5://127.0.0.1:1080',
        HTTPS_PROXY: 'http://proxy.example.com:8080',
      });
      expect(detectEnvProxy()).toEqual({
        url: 'socks5://127.0.0.1:1080',
        type: 'socks',
      });
    });

    it('should prioritize HTTPS_PROXY over ALL_PROXY', () => {
      restoreEnv = mockEnv({
        HTTPS_PROXY: 'http://https-proxy.example.com:8080',
        ALL_PROXY: 'http://all-proxy.example.com:8080',
      });
      expect(detectEnvProxy()).toEqual({
        url: 'http://https-proxy.example.com:8080',
        type: 'http',
      });
    });

    it('should prioritize ALL_PROXY over HTTP_PROXY', () => {
      restoreEnv = mockEnv({
        ALL_PROXY: 'http://all-proxy.example.com:8080',
        HTTP_PROXY: 'http://http-proxy.example.com:8080',
      });
      expect(detectEnvProxy()).toEqual({
        url: 'http://all-proxy.example.com:8080',
        type: 'http',
      });
    });
  });
});
