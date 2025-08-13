/**
 * Simple integration tests for core functionality
 */

import { jest } from '@jest/globals';
import nock from 'nock';
import { mockEnv, createTempDir, cleanupTempDir } from '../utils/test-helpers.js';
import { createMockToken } from '../utils/mock-factories.js';

describe('Core Integration Tests', () => {
  let restoreEnv: () => void;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    
    restoreEnv = mockEnv({
      WP_API_URL: 'https://test-site.wordpress.com',
      WP_OAUTH_CLIENT_ID: 'test_client_id',
      WP_OAUTH_CLIENT_SECRET: 'test_client_secret',
      OAUTH_ENABLED: 'true',
      WP_MCP_CONFIG_DIR: tempDir,
      NODE_ENV: 'test',
    });

    jest.resetModules();
    nock.cleanAll();
  });

  afterEach(async () => {
    nock.cleanAll();
    if (restoreEnv) {
      restoreEnv();
    }
    await cleanupTempDir(tempDir);
  });

  describe('Configuration Integration', () => {
    it('should validate complete configuration setup', async () => {
      const { validateConfig, CONFIG } = await import('../../src/lib/config.js');
      
      const result = validateConfig();
      
      expect(result.isValid).toBe(true);
      expect(CONFIG.WP_API_URL).toBe('https://test-site.wordpress.com');
      expect(CONFIG.OAUTH_ENABLED).toBe(true);
    });

    it('should recommend correct OAuth config based on site type', async () => {
      const { getRecommendedOAuthConfig, isWordPressComSite } = await import('../../src/lib/config.js');
      
      // Test WordPress.com site
      const wpcomConfig = getRecommendedOAuthConfig('https://example.wordpress.com');
      expect(wpcomConfig.flowType).toBe('implicit');
      expect(wpcomConfig.authorizationEndpoint).toBe('https://public-api.wordpress.com/oauth2/authorize');
      
      // Test self-hosted site
      const selfHostedConfig = getRecommendedOAuthConfig('https://example.com');
      expect(selfHostedConfig.flowType).toBe('authorization_code');
      expect(selfHostedConfig.usePKCE).toBe(true);
    });
  });

  describe('OAuth Utils Integration', () => {
    it('should generate valid PKCE data for OAuth 2.1', async () => {
      const { generatePKCE, generateSecureState } = await import('../../src/lib/mcp-oauth-utils.js');
      
      const pkce = generatePKCE();
      const state = generateSecureState();
      
      expect(pkce.codeVerifier).toBeTruthy();
      expect(pkce.codeChallenge).toBeTruthy();
      expect(pkce.codeChallengeMethod).toBe('S256');
      expect(state).toBeTruthy();
      expect(state.length).toBeGreaterThan(20);
    });

    it('should build complete authorization URLs', async () => {
      const { buildAuthorizationUrl, generatePKCE, generateSecureState } = await import('../../src/lib/mcp-oauth-utils.js');
      
      const pkce = generatePKCE();
      const state = generateSecureState();
      
      const url = buildAuthorizationUrl(
        'https://public-api.wordpress.com/oauth2/authorize',
        'test_client_id',
        'http://localhost:3000/callback',
        ['global'],
        state,
        pkce.codeChallenge
      );
      
      const urlObj = new URL(url);
      expect(urlObj.searchParams.get('response_type')).toBe('code');
      expect(urlObj.searchParams.get('client_id')).toBe('test_client_id');
      expect(urlObj.searchParams.get('code_challenge')).toBe(pkce.codeChallenge);
      expect(urlObj.searchParams.get('code_challenge_method')).toBe('S256');
    });

    it('should parse WWW-Authenticate headers correctly', async () => {
      const { parseWWWAuthenticateHeader } = await import('../../src/lib/mcp-oauth-utils.js');
      
      const header = 'Bearer realm="WordPress API", error="invalid_token", error_description="Token expired"';
      const parsed = parseWWWAuthenticateHeader(header);
      
      expect(parsed.scheme).toBe('Bearer');
      expect(parsed.realm).toBe('WordPress API');
      expect(parsed.error).toBe('invalid_token');
      expect(parsed.error_description).toBe('Token expired');
    });
  });

  describe('OAuth Callback Server Integration', () => {
    it('should import OAuth callback server classes', async () => {
      const { OAuthCallbackServer } = await import('../../src/lib/oauth-callback-server.js');
      
      // Test that the class is importable and is a constructor
      expect(typeof OAuthCallbackServer).toBe('function');
      expect(OAuthCallbackServer.name).toBe('OAuthCallbackServer');
    });
  });

  describe('OAuth Types and Error Handling', () => {
    it('should handle OAuth errors correctly', async () => {
      const { AuthError, APIError } = await import('../../src/lib/oauth-types.js');
      
      const authError = new AuthError('Invalid credentials', 'INVALID_CREDENTIALS');
      const apiError = new APIError('API request failed', 500, '/test/endpoint');
      
      expect(authError.message).toBe('Invalid credentials');
      expect(apiError.statusCode).toBe(500);
      expect(apiError.endpoint).toBe('/test/endpoint');
      expect(apiError.message).toBe('API request failed');
    });
  });

  describe('Utility Functions Integration', () => {
    it('should integrate logging functionality', async () => {
      const { logger } = await import('../../src/lib/utils.js');
      
      // Test that logger methods exist and can be called
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.debug).toBe('function');
      
      // These should not throw
      logger.info('Test info message', 'TEST');
      logger.error('Test error message', 'TEST');
      logger.debug('Test debug message', 'TEST');
    });
  });

  describe('Module Integration', () => {
    it('should import all core modules without errors', async () => {
      // Test that all modules can be imported without throwing
      await expect(import('../../src/lib/config.js')).resolves.toBeDefined();
      await expect(import('../../src/lib/mcp-oauth-utils.js')).resolves.toBeDefined();
      await expect(import('../../src/lib/oauth-types.js')).resolves.toBeDefined();
      await expect(import('../../src/lib/utils.js')).resolves.toBeDefined();
      await expect(import('../../src/lib/oauth-callback-server.js')).resolves.toBeDefined();
    });

    it('should have consistent TypeScript interfaces', async () => {
      const mockToken = createMockToken();
      
      // Mock token should conform to WPTokens interface structure
      expect(mockToken).toHaveProperty('access_token');
      expect(mockToken).toHaveProperty('token_type');
      expect(mockToken).toHaveProperty('obtained_at');
      expect(typeof mockToken.access_token).toBe('string');
      expect(typeof mockToken.token_type).toBe('string');
      expect(typeof mockToken.obtained_at).toBe('number');
    });
  });

  describe('Environment Configuration Integration', () => {
    it('should handle different environment configurations', async () => {
      // Test production-like configuration
      restoreEnv();
      restoreEnv = mockEnv({
        WP_API_URL: 'https://production-site.com',
        WP_OAUTH_CLIENT_ID: 'prod_client_id',
        OAUTH_ENABLED: 'true',
        NODE_ENV: 'production',
        WP_MCP_CONFIG_DIR: tempDir,
      });

      const { CONFIG, validateConfig } = await import('../../src/lib/config.js');
      
      expect(CONFIG.NODE_ENV).toBe('production');
      expect(CONFIG.WP_API_URL).toBe('https://production-site.com');
      
      const validation = validateConfig();
      expect(validation.isValid).toBe(true);
    });

    it('should handle development configuration', async () => {
      restoreEnv();
      restoreEnv = mockEnv({
        WP_API_URL: 'http://localhost:8080',
        WP_OAUTH_CLIENT_ID: 'dev_client_id',
        OAUTH_ENABLED: 'true',
        NODE_ENV: 'development',
        WP_MCP_CONFIG_DIR: tempDir,
      });

      const { CONFIG } = await import('../../src/lib/config.js');
      
      expect(CONFIG.NODE_ENV).toBe('development');
      expect(CONFIG.WP_API_URL).toBe('http://localhost:8080');
    });
  });
});
