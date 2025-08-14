/**
 * Unit tests for wordpress-api module
 */

import { jest } from '@jest/globals';
import nock from 'nock';
import { mockEnv } from '../utils/test-helpers.js';

// Mock the OAuth provider to avoid ESM issues with 'open' module
jest.unstable_mockModule('../../src/lib/mcp-oauth-provider.js', () => ({
  MCPOAuthProvider: jest.fn().mockImplementation(() => ({
    authorize: jest.fn().mockImplementation(() => Promise.resolve()),
    tokens: jest.fn().mockImplementation(() => Promise.resolve(null)),
  })),
}));

// Mock persistent OAuth client provider
jest.unstable_mockModule('../../src/lib/persistent-oauth-client-provider.js', () => ({
  PersistentWPOAuthClientProvider: jest.fn().mockImplementation(() => ({})),
}));

// Mock coordination module
jest.unstable_mockModule('../../src/lib/coordination.js', () => ({
  createLazyWPAuthCoordinator: jest.fn().mockReturnValue({
    waitForAuth: jest.fn().mockImplementation(() => Promise.resolve(null)),
  }),
}));

describe('WordPress API Module', () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    jest.resetModules();
    nock.cleanAll();
  });

  afterEach(() => {
    if (restoreEnv) {
      restoreEnv();
    }
    nock.cleanAll();
  });

  describe('wpRequest function', () => {
    describe('Environment validation', () => {
      it('should throw AuthError when configuration validation fails', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: '', // Invalid empty URL
        });

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        
        await expect(wpRequest({ method: 'initialize' })).rejects.toThrow(
          'Configuration validation failed'
        );
      });

      it('should proceed when configuration is valid', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://test-site.com',
          JWT_TOKEN: 'test-jwt-token',
        });

        // Mock the API response
        nock('https://test-site.com')
          .post('/?rest_route=/wp/v2/mcp/v1')
          .reply(200, { status: 'success', data: 'test' });

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        
        const response = await wpRequest({ method: 'initialize' });
        expect(response).toEqual({ status: 'success', data: 'test' });
      });
    });

    describe('URL construction', () => {
      it('should use REST route format for standard WordPress sites', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://example.com',
          JWT_TOKEN: 'test-jwt-token',
        });

        nock('https://example.com')
          .post('/?rest_route=/wp/v2/mcp/v1')
          .reply(200, { status: 'success' });

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        await wpRequest({ method: 'initialize' });

        expect(nock.isDone()).toBe(true);
      });



      it('should use exact URL when custom path is provided', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://example.com/custom/path',
          JWT_TOKEN: 'test-jwt-token',
        });

        nock('https://example.com')
          .post('/custom/path')
          .reply(200, { status: 'success' });

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        await wpRequest({ method: 'initialize' });

        expect(nock.isDone()).toBe(true);
      });

      it('should remove trailing slashes from URL', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://example.com///',
          JWT_TOKEN: 'test-jwt-token',
        });

        nock('https://example.com')
          .post('/?rest_route=/wp/v2/mcp/v1')
          .reply(200, { status: 'success' });

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        await wpRequest({ method: 'initialize' });

        expect(nock.isDone()).toBe(true);
      });
    });

    describe('Authentication methods', () => {
      describe('JWT Token authentication', () => {
        it('should use JWT token when available', async () => {
          restoreEnv = mockEnv({
            WP_API_URL: 'https://example.com',
            JWT_TOKEN: 'test-jwt-token-12345',
          });

          nock('https://example.com')
            .post('/?rest_route=/wp/v2/mcp/v1')
            .matchHeader('authorization', 'Bearer test-jwt-token-12345')
            .reply(200, { status: 'success' });

          const { wpRequest } = await import('../../src/lib/wordpress-api.js');
          await wpRequest({ method: 'initialize' });

          expect(nock.isDone()).toBe(true);
        });

        it('should log JWT token length for debugging', async () => {
          restoreEnv = mockEnv({
            WP_API_URL: 'https://example.com',
            JWT_TOKEN: 'test-jwt-token',
          });

          nock('https://example.com')
            .post('/?rest_route=/wp/v2/mcp/v1')
            .reply(200, { status: 'success' });

          const logSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

          const { wpRequest } = await import('../../src/lib/wordpress-api.js');
          await wpRequest({ method: 'initialize' });

          logSpy.mockRestore();
        });
      });

      describe('Basic Auth authentication', () => {
        it('should use WordPress Basic Auth when JWT is not available', async () => {
          restoreEnv = mockEnv({
            WP_API_URL: 'https://example.com',
            WP_API_USERNAME: 'testuser',
            WP_API_PASSWORD: 'testpass',
          });

          const expectedAuth = Buffer.from('testuser:testpass').toString('base64');
          
          nock('https://example.com')
            .post('/?rest_route=/wp/v2/mcp/v1')
            .matchHeader('authorization', `Basic ${expectedAuth}`)
            .reply(200, { status: 'success' });

          const { wpRequest } = await import('../../src/lib/wordpress-api.js');
          await wpRequest({ method: 'initialize' });

          expect(nock.isDone()).toBe(true);
        });

        it('should use WooCommerce credentials for WooCommerce report tools', async () => {
          restoreEnv = mockEnv({
            WP_API_URL: 'https://example.com',
            WOO_CUSTOMER_KEY: 'woo_key',
            WOO_CUSTOMER_SECRET: 'woo_secret',
          });

          const expectedAuth = Buffer.from('woo_key:woo_secret').toString('base64');
          
          nock('https://example.com')
            .post('/?rest_route=/wp/v2/mcp/v1')
            .matchHeader('authorization', `Basic ${expectedAuth}`)
            .reply(200, { status: 'success' });

          const { wpRequest } = await import('../../src/lib/wordpress-api.js');
          await wpRequest({ 
            method: 'tools/call',
            args: { tool: 'wc_reports_sales' }
          });

          expect(nock.isDone()).toBe(true);
        });

        it('should throw AuthError when WooCommerce credentials are missing for WooCommerce tools', async () => {
          restoreEnv = mockEnv({
            WP_API_URL: 'https://example.com',
            // Missing WOO_CUSTOMER_KEY and WOO_CUSTOMER_SECRET
          });

          const { wpRequest } = await import('../../src/lib/wordpress-api.js');
          
          await expect(wpRequest({ 
            method: 'tools/call',
            args: { tool: 'wc_reports_sales' }
          })).rejects.toThrow('Missing WooCommerce credentials');
        });
      });

      describe('OAuth authentication', () => {
        it('should attempt OAuth when enabled and no JWT token', async () => {
          restoreEnv = mockEnv({
            WP_API_URL: 'https://example.com',
            OAUTH_ENABLED: 'true',
            WP_OAUTH_CLIENT_ID: 'test-client-id',
          });

          // Mock OAuth to return no tokens (will fallback to Basic Auth)
          nock('https://example.com')
            .post('/?rest_route=/wp/v2/mcp/v1')
            .reply(200, { status: 'success' });

          const { wpRequest } = await import('../../src/lib/wordpress-api.js');
          
          // This should attempt OAuth but fallback gracefully
          await expect(wpRequest({ method: 'initialize' })).rejects.toThrow(
            'No authentication method available'
          );
        });

        it('should fallback to Basic Auth when OAuth fails', async () => {
          restoreEnv = mockEnv({
            WP_API_URL: 'https://example.com',
            OAUTH_ENABLED: 'true',
            WP_OAUTH_CLIENT_ID: 'test-client-id',
            WP_API_USERNAME: 'fallback-user',
            WP_API_PASSWORD: 'fallback-pass',
          });

          const expectedAuth = Buffer.from('fallback-user:fallback-pass').toString('base64');
          
          nock('https://example.com')
            .post('/?rest_route=/wp/v2/mcp/v1')
            .matchHeader('authorization', `Basic ${expectedAuth}`)
            .reply(200, { status: 'success' });

          const { wpRequest } = await import('../../src/lib/wordpress-api.js');
          await wpRequest({ method: 'initialize' });

          expect(nock.isDone()).toBe(true);
        });
      });

      describe('No authentication', () => {
        it('should throw AuthError when no authentication method is configured', async () => {
          restoreEnv = mockEnv({
            WP_API_URL: 'https://example.com',
            // No authentication methods configured
          });

          const { wpRequest } = await import('../../src/lib/wordpress-api.js');
          
          await expect(wpRequest({ method: 'initialize' })).rejects.toThrow(
            'No authentication method available'
          );
        });
      });
    });

    describe('Request handling', () => {
      it('should send POST request with correct headers', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://example.com',
          JWT_TOKEN: 'test-token',
        });

        nock('https://example.com')
          .post('/?rest_route=/wp/v2/mcp/v1')
          .matchHeader('authorization', 'Bearer test-token')
          .matchHeader('content-type', 'application/json')
          .reply(200, { status: 'success' });

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        await wpRequest({ method: 'initialize' });

        expect(nock.isDone()).toBe(true);
      });

      it('should send request body as JSON', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://example.com',
          JWT_TOKEN: 'test-token',
        });

        const requestParams = { method: 'tools/list', cursor: 'abc123' };
        
        nock('https://example.com')
          .post('/?rest_route=/wp/v2/mcp/v1', requestParams)
          .reply(200, { status: 'success' });

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        await wpRequest(requestParams);

        expect(nock.isDone()).toBe(true);
      });

      it('should handle successful API responses', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://example.com',
          JWT_TOKEN: 'test-token',
        });

        const expectedResponse = { 
          status: 'success', 
          data: { tools: ['tool1', 'tool2'] } 
        };
        
        nock('https://example.com')
          .post('/?rest_route=/wp/v2/mcp/v1')
          .reply(200, expectedResponse);

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        const response = await wpRequest({ method: 'tools/list' });

        expect(response).toEqual(expectedResponse);
      });
    });

    describe('Error handling', () => {
      it('should throw APIError for HTTP error responses', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://example.com',
          JWT_TOKEN: 'test-token',
        });

        nock('https://example.com')
          .post('/?rest_route=/wp/v2/mcp/v1')
          .reply(401, 'Unauthorized');

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        
        await expect(wpRequest({ method: 'initialize' })).rejects.toThrow(
          'WordPress API error (401): Unauthorized'
        );
      });

      it('should throw APIError for network errors', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://example.com',
          JWT_TOKEN: 'test-token',
        });

        nock('https://example.com')
          .post('/?rest_route=/wp/v2/mcp/v1')
          .replyWithError('Network error');

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        
        await expect(wpRequest({ method: 'initialize' })).rejects.toThrow(
          'Network error'
        );
      });

      it('should throw APIError for invalid JSON responses', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://example.com',
          JWT_TOKEN: 'test-token',
        });

        nock('https://example.com')
          .post('/?rest_route=/wp/v2/mcp/v1')
          .reply(200, 'invalid json');

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        
        await expect(wpRequest({ method: 'initialize' })).rejects.toThrow();
      });
    });

    describe('Default parameters', () => {
      it('should handle default parameters when none provided', async () => {
        restoreEnv = mockEnv({
          WP_API_URL: 'https://example.com',
          JWT_TOKEN: 'test-token',
        });

        nock('https://example.com')
          .post('/?rest_route=/wp/v2/mcp/v1', { method: 'init' })
          .reply(200, { status: 'success' });

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        await wpRequest();

        expect(nock.isDone()).toBe(true);
      });
    });
  });

  describe('Helper functions', () => {
    describe('removeTrailingSlash', () => {
      it('should be tested through URL construction', async () => {
        // This function is private but tested through wpRequest behavior
        restoreEnv = mockEnv({
          WP_API_URL: 'https://example.com//',
          JWT_TOKEN: 'test-token',
        });

        nock('https://example.com')
          .post('/?rest_route=/wp/v2/mcp/v1')
          .reply(200, { status: 'success' });

        const { wpRequest } = await import('../../src/lib/wordpress-api.js');
        await wpRequest({ method: 'initialize' });

        expect(nock.isDone()).toBe(true);
      });
    });

    describe('constructApiUrl', () => {
      it('should handle various URL formats correctly through wpRequest', async () => {
        // Testing different URL construction scenarios through wpRequest
        const testCases = [
          {
            url: 'https://example.com',
            expectedPath: '/?rest_route=/wp/v2/mcp/v1'
          },
          {
            url: 'https://api.mysite.com',
            expectedPath: '/?rest_route=/wp/v2/mcp/v1'
          },
          {
            url: 'https://example.com/custom',
            expectedPath: '/custom'
          }
        ];

        for (const testCase of testCases) {
          restoreEnv = mockEnv({
            WP_API_URL: testCase.url,
            JWT_TOKEN: 'test-token',
          });

          const urlObj = new URL(testCase.url);
          nock(`${urlObj.protocol}//${urlObj.host}`)
            .post(testCase.expectedPath)
            .reply(200, { status: 'success' });

          jest.resetModules();
          const { wpRequest } = await import('../../src/lib/wordpress-api.js');
          await wpRequest({ method: 'initialize' });

          expect(nock.isDone()).toBe(true);
          nock.cleanAll();
          if (restoreEnv) restoreEnv();
        }
      });
    });
  });

  describe('OAuth token management', () => {
    it('should handle getOAuthTokens when OAuth is disabled', async () => {
      restoreEnv = mockEnv({
        WP_API_URL: 'https://example.com',
        OAUTH_ENABLED: 'false',
        WP_API_USERNAME: 'testuser',
        WP_API_PASSWORD: 'testpass',
      });

      const expectedAuth = Buffer.from('testuser:testpass').toString('base64');
      
      nock('https://example.com')
        .post('/?rest_route=/wp/v2/mcp/v1')
        .matchHeader('authorization', `Basic ${expectedAuth}`)
        .reply(200, { status: 'success' });

      const { wpRequest } = await import('../../src/lib/wordpress-api.js');
      await wpRequest({ method: 'initialize' });

      expect(nock.isDone()).toBe(true);
    });
  });
});
