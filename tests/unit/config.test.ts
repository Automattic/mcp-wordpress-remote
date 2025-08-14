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
      expect(CONFIG.OAUTH_CALLBACK_PORT).toBeUndefined(); // Default is undefined for auto-select
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
        OAUTH_CALLBACK_PORT: '7665',
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
      expect(result.errors.some(error => error.includes('WP_API_URL must be set to your WordPress site URL'))).toBe(true);
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
      expect(result.errors.some(error => error.includes('OAUTH_CALLBACK_PORT must be a valid port number (1-65535)'))).toBe(true);
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
      expect(result.errors.some(error => error.includes('No authentication method configured. Please set one of: JWT_TOKEN, WP_API_USERNAME+WP_API_PASSWORD, or enable OAuth'))).toBe(true);
    });
  });

  describe('getDefaultOAuthScopes function', () => {
    it('should return default OAuth scopes', async () => {
      const { getDefaultOAuthScopes } = await import('../../src/lib/config.js');

      const scopes = getDefaultOAuthScopes();
      expect(scopes).toEqual(['read', 'write']);
    });

    it('should respect custom scopes from environment variable', async () => {
      restoreEnv = mockEnv({
        OAUTH_SCOPES: 'custom,scopes,test',
      });

      const { getDefaultOAuthScopes } = await import('../../src/lib/config.js');

      const scopes = getDefaultOAuthScopes();
      expect(scopes).toEqual(['custom', 'scopes', 'test']);
    });

    it('should handle empty scopes environment variable', async () => {
      restoreEnv = mockEnv({
        OAUTH_SCOPES: '',
      });

      const { getDefaultOAuthScopes } = await import('../../src/lib/config.js');

      const scopes = getDefaultOAuthScopes();
      expect(scopes).toEqual(['read', 'write']);
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

  describe('parseOAuthScopes function', () => {
    it('should return default scopes when environment variable is empty', async () => {
      const { parseOAuthScopes } = await import('../../src/lib/config.js');
      
      const defaultScopes = ['read', 'write'];
      expect(parseOAuthScopes('', defaultScopes)).toEqual(['read', 'write']);
      expect(parseOAuthScopes('   ', defaultScopes)).toEqual(['read', 'write']);
    });

    it('should parse comma-separated scopes correctly', async () => {
      const { parseOAuthScopes } = await import('../../src/lib/config.js');
      
      const defaultScopes = ['read', 'write'];
      expect(parseOAuthScopes('global', defaultScopes)).toEqual(['global']);
      expect(parseOAuthScopes('read,write,admin', defaultScopes)).toEqual(['read', 'write', 'admin']);
      expect(parseOAuthScopes(' read , write , admin ', defaultScopes)).toEqual(['read', 'write', 'admin']);
    });

    it('should filter out empty scopes', async () => {
      const { parseOAuthScopes } = await import('../../src/lib/config.js');
      
      const defaultScopes = ['read', 'write'];
      expect(parseOAuthScopes('read,,write', defaultScopes)).toEqual(['read', 'write']);
      expect(parseOAuthScopes(',read,write,', defaultScopes)).toEqual(['read', 'write']);
    });

    it('should handle single scope correctly', async () => {
      const { parseOAuthScopes } = await import('../../src/lib/config.js');
      
      const defaultScopes = ['read', 'write'];
      expect(parseOAuthScopes('global', defaultScopes)).toEqual(['global']);
    });
  });



  describe('Health status function', () => {
    it('should return health status with configuration state', async () => {
      restoreEnv = mockEnv({
        WP_API_URL: 'https://test-site.com',
        JWT_TOKEN: 'test-token',
      });

      const { getConfigHealthStatus } = await import('../../src/lib/config.js');
      const status = getConfigHealthStatus();

      expect(status.status).toBe('healthy');
      expect(status.version).toBe('0.2.9');
      expect(status.uptime).toBeGreaterThan(0);
      expect(status.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should return unhealthy status for invalid configuration', async () => {
      restoreEnv = mockEnv({
        WP_API_URL: '', // Invalid
      });

      const { getConfigHealthStatus } = await import('../../src/lib/config.js');
      const status = getConfigHealthStatus();

      expect(status.status).toBe('unhealthy');
    });
  });
});
