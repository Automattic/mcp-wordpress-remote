/**
 * Unit tests for configuration module
 */

import { jest } from '@jest/globals';
import { mockEnv } from '../utils/test-helpers.js';

describe('Configuration Module', () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    // Clear module cache to get fresh config
    jest.resetModules();
  });

  afterEach(() => {
    if (restoreEnv) {
      restoreEnv();
    }
  });

  describe('CONFIG object', () => {
    it('should have default values when no environment variables are set', async () => {
      restoreEnv = mockEnv({});
      
      const { CONFIG } = await import('../../src/lib/config.js');
      
      expect(CONFIG.WP_API_URL).toBe('https://example.com');
      expect(CONFIG.OAUTH_ENABLED).toBe(false); // OAuth is disabled by default
      expect(CONFIG.OAUTH_CALLBACK_PORT).toBe(3000);
      expect(CONFIG.OAUTH_HOST).toBe('127.0.0.1');
      expect(CONFIG.WP_OAUTH_CLIENT_ID).toBe('');
      expect(CONFIG.OAUTH_FLOW_TYPE).toBe('authorization_code');
      expect(CONFIG.OAUTH_USE_PKCE).toBe(true);
      expect(CONFIG.NODE_ENV).toBe('test'); // NODE_ENV is set to 'test' in test environment
    });

    it('should override defaults with environment variables', async () => {
      restoreEnv = mockEnv({
        WP_API_URL: 'https://custom-site.com',
        OAUTH_ENABLED: 'false',
        OAUTH_CALLBACK_PORT: '4000',
        OAUTH_HOST: '0.0.0.0',
        WP_OAUTH_CLIENT_ID: 'custom_client_id',
        OAUTH_FLOW_TYPE: 'implicit',
        OAUTH_USE_PKCE: 'false',
        NODE_ENV: 'production',
      });

      const { CONFIG } = await import('../../src/lib/config.js');

      expect(CONFIG.WP_API_URL).toBe('https://custom-site.com');
      expect(CONFIG.OAUTH_ENABLED).toBe(false);
      expect(CONFIG.OAUTH_CALLBACK_PORT).toBe(4000);
      expect(CONFIG.OAUTH_HOST).toBe('0.0.0.0');
      expect(CONFIG.WP_OAUTH_CLIENT_ID).toBe('custom_client_id');
      expect(CONFIG.OAUTH_FLOW_TYPE).toBe('implicit');
      expect(CONFIG.OAUTH_USE_PKCE).toBe(false);
      expect(CONFIG.NODE_ENV).toBe('production');
    });

    it('should handle invalid port numbers gracefully', async () => {
      restoreEnv = mockEnv({
        OAUTH_CALLBACK_PORT: 'invalid',
      });

      const { CONFIG } = await import('../../src/lib/config.js');

      expect(CONFIG.OAUTH_CALLBACK_PORT).toBeNaN();
    });
  });

  describe('validateConfig function', () => {
    it('should validate a complete configuration', async () => {
      restoreEnv = mockEnv({
        WP_API_URL: 'https://test-site.wordpress.com',
        WP_OAUTH_CLIENT_ID: 'test_client_id',
        OAUTH_CALLBACK_PORT: '3000',
        OAUTH_ENABLED: 'true', // Enable OAuth for validation to pass
      });

      const { validateConfig } = await import('../../src/lib/config.js');
      const result = validateConfig();

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation when required fields are missing', async () => {
      restoreEnv = mockEnv({
        WP_API_URL: '',
        WP_OAUTH_CLIENT_ID: '',
      });

      const { validateConfig } = await import('../../src/lib/config.js');
      const result = validateConfig();

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('WP_API_URL must be set to your WordPress site URL');
    });

    it('should pass validation with valid URL format', async () => {
      restoreEnv = mockEnv({
        WP_API_URL: 'https://test-site.com',
        WP_OAUTH_CLIENT_ID: 'test_client_id',
        OAUTH_ENABLED: 'true', // Enable OAuth for validation to pass
      });

      const { validateConfig } = await import('../../src/lib/config.js');
      const result = validateConfig();

      expect(result.isValid).toBe(true);
    });

    it('should validate port number range', async () => {
      restoreEnv = mockEnv({
        WP_API_URL: 'https://test-site.com',
        WP_OAUTH_CLIENT_ID: 'test_client_id',
        OAUTH_CALLBACK_PORT: '99999',
        OAUTH_ENABLED: 'true', // Enable OAuth for port validation to trigger
      });

      const { validateConfig } = await import('../../src/lib/config.js');
      const result = validateConfig();

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('OAUTH_CALLBACK_PORT must be a valid port number (1-65535)');
    });

    it('should require some authentication method even when OAuth is disabled', async () => {
      restoreEnv = mockEnv({
        WP_API_URL: 'https://test-site.com',
        OAUTH_ENABLED: 'false',
        WP_OAUTH_CLIENT_ID: '', // This would normally be required
      });

      const { validateConfig } = await import('../../src/lib/config.js');
      const result = validateConfig();

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('No authentication method configured. Please set one of: JWT_TOKEN, WP_API_USERNAME+WP_API_PASSWORD, or enable OAuth');
    });
  });

  describe('isWordPressComSite function', () => {
    it('should identify WordPress.com sites correctly', async () => {
      const { isWordPressComSite } = await import('../../src/lib/config.js');

      expect(isWordPressComSite('https://example.wordpress.com')).toBe(true);
      expect(isWordPressComSite('https://subdomain.wordpress.com')).toBe(true);
      expect(isWordPressComSite('https://public-api.wordpress.com')).toBe(true);
    });

    it('should identify self-hosted WordPress sites correctly', async () => {
      const { isWordPressComSite } = await import('../../src/lib/config.js');

      expect(isWordPressComSite('https://example.com')).toBe(false);
      expect(isWordPressComSite('https://blog.example.com')).toBe(false);
      expect(isWordPressComSite('https://my-site.org')).toBe(false);
    });

    it('should handle URLs with different protocols and paths', async () => {
      const { isWordPressComSite } = await import('../../src/lib/config.js');

      expect(isWordPressComSite('http://example.wordpress.com')).toBe(true);
      expect(isWordPressComSite('https://example.wordpress.com/wp-admin')).toBe(true);
      expect(isWordPressComSite('https://example.com/wordpress')).toBe(false);
    });

    it('should handle invalid URLs gracefully', async () => {
      const { isWordPressComSite } = await import('../../src/lib/config.js');

      expect(isWordPressComSite('invalid-url')).toBe(false);
      expect(isWordPressComSite('')).toBe(false);
      expect(isWordPressComSite('javascript:alert(1)')).toBe(false);
    });
  });

  describe('getRecommendedOAuthConfig function', () => {
    it('should return WordPress.com OAuth config for WordPress.com sites', async () => {
      const { getRecommendedOAuthConfig } = await import('../../src/lib/config.js');

      const config = getRecommendedOAuthConfig('https://example.wordpress.com');

      expect(config.authorizationEndpoint).toBe('https://public-api.wordpress.com/oauth2/authorize');
      expect(config.tokenEndpoint).toBe('https://public-api.wordpress.com/oauth2/token');
    });

    it('should return self-hosted OAuth config for self-hosted sites', async () => {
      const { getRecommendedOAuthConfig } = await import('../../src/lib/config.js');

      const config = getRecommendedOAuthConfig('https://example.com');

      expect(config.flowType).toBe('authorization_code');
      expect(config.usePKCE).toBe(true);
      expect(config.useResourceIndicator).toBe(true);
      expect(config.authorizationEndpoint).toBeUndefined(); // Will be discovered
      expect(config.tokenEndpoint).toBeUndefined(); // Will be discovered
      expect(config.description).toBe('MCP-compliant OAuth 2.1');
    });

    it('should handle URLs with paths correctly', async () => {
      const { getRecommendedOAuthConfig } = await import('../../src/lib/config.js');

      const config = getRecommendedOAuthConfig('https://example.com/blog');

      expect(config.flowType).toBe('authorization_code');
      expect(config.authorizationEndpoint).toBeUndefined(); // Will be discovered
      expect(config.tokenEndpoint).toBeUndefined(); // Will be discovered
    });

    it('should handle URLs with trailing slashes', async () => {
      const { getRecommendedOAuthConfig } = await import('../../src/lib/config.js');

      const config = getRecommendedOAuthConfig('https://example.com/');

      expect(config.flowType).toBe('authorization_code');
      expect(config.authorizationEndpoint).toBeUndefined(); // Will be discovered
      expect(config.tokenEndpoint).toBeUndefined(); // Will be discovered
    });
  });

  describe('OAuth 2.1 compliance', () => {
    it('should have OAuth 2.1 features enabled by default', async () => {
      restoreEnv = mockEnv({});

      const { CONFIG } = await import('../../src/lib/config.js');

      expect(CONFIG.OAUTH_USE_PKCE).toBe(true);
      expect(CONFIG.OAUTH_DYNAMIC_REGISTRATION).toBe(true);
      expect(CONFIG.OAUTH_RESOURCE_INDICATOR).toBe(true);
    });

    it('should allow disabling OAuth 2.1 features via environment variables', async () => {
      restoreEnv = mockEnv({
        OAUTH_USE_PKCE: 'false',
        OAUTH_DYNAMIC_REGISTRATION: 'false',
        OAUTH_RESOURCE_INDICATOR: 'false',
      });

      const { CONFIG } = await import('../../src/lib/config.js');

      expect(CONFIG.OAUTH_USE_PKCE).toBe(false);
      expect(CONFIG.OAUTH_DYNAMIC_REGISTRATION).toBe(false);
      expect(CONFIG.OAUTH_RESOURCE_INDICATOR).toBe(false);
    });
  });

  describe('timeout configuration', () => {
    it('should have reasonable default timeouts', async () => {
      const { CONFIG } = await import('../../src/lib/config.js');

      expect(CONFIG.OAUTH_TIMEOUT).toBe(30000); // 30 seconds
      expect(CONFIG.LOCK_TIMEOUT).toBe(300000); // 5 minutes
    });
  });

  describe('directory configuration', () => {
    it('should use home directory for config by default', async () => {
      const { CONFIG } = await import('../../src/lib/config.js');

      expect(CONFIG.WP_MCP_CONFIG_DIR).toMatch(/\.mcp-auth$/);
      expect(CONFIG.WP_MCP_CONFIG_DIR).toContain(require('os').homedir());
    });

    it('should allow custom config directory', async () => {
      restoreEnv = mockEnv({
        WP_MCP_CONFIG_DIR: '/custom/config/dir',
      });

      const { CONFIG } = await import('../../src/lib/config.js');

      expect(CONFIG.WP_MCP_CONFIG_DIR).toBe('/custom/config/dir');
    });
  });
});
