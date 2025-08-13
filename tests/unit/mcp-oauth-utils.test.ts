/**
 * Unit tests for MCP OAuth utilities
 */

import { jest } from '@jest/globals';
import crypto from 'crypto';

describe('MCP OAuth Utils', () => {
  describe('generatePKCE', () => {
    it('should generate valid PKCE data', async () => {
      const { generatePKCE } = await import('../../src/lib/mcp-oauth-utils.js');
      
      const pkce = generatePKCE();

      expect(pkce).toHaveProperty('codeVerifier');
      expect(pkce).toHaveProperty('codeChallenge');
      expect(pkce).toHaveProperty('codeChallengeMethod');

      expect(typeof pkce.codeVerifier).toBe('string');
      expect(typeof pkce.codeChallenge).toBe('string');
      expect(pkce.codeChallengeMethod).toBe('S256');

      // Verify code verifier is properly formatted
      expect(pkce.codeVerifier.length).toBeGreaterThanOrEqual(43);
      expect(pkce.codeVerifier.length).toBeLessThanOrEqual(128);
      expect(pkce.codeVerifier).toMatch(/^[A-Za-z0-9\-._~]+$/);

      // Verify code challenge is properly formatted
      expect(pkce.codeChallenge).toMatch(/^[A-Za-z0-9\-._~]+$/);
    });

    it('should generate different PKCE data on each call', async () => {
      const { generatePKCE } = await import('../../src/lib/mcp-oauth-utils.js');
      
      const pkce1 = generatePKCE();
      const pkce2 = generatePKCE();

      expect(pkce1.codeVerifier).not.toBe(pkce2.codeVerifier);
      expect(pkce1.codeChallenge).not.toBe(pkce2.codeChallenge);
    });

    it('should generate consistent challenge from verifier', async () => {
      const { generatePKCE } = await import('../../src/lib/mcp-oauth-utils.js');
      
      const pkce = generatePKCE();
      
      // Manually calculate expected challenge
      const expectedChallenge = crypto
        .createHash('sha256')
        .update(pkce.codeVerifier)
        .digest('base64url');

      expect(pkce.codeChallenge).toBe(expectedChallenge);
    });
  });

  describe('generateCanonicalResourceURI', () => {
    it('should normalize basic URLs correctly', async () => {
      const { generateCanonicalResourceURI } = await import('../../src/lib/mcp-oauth-utils.js');

      expect(generateCanonicalResourceURI('https://Example.Com/Path'))
        .toBe('https://example.com/Path');
    });

    it('should remove fragments', async () => {
      const { generateCanonicalResourceURI } = await import('../../src/lib/mcp-oauth-utils.js');

      expect(generateCanonicalResourceURI('https://example.com/path#fragment'))
        .toBe('https://example.com/path');
    });

    it('should handle trailing slashes appropriately', async () => {
      const { generateCanonicalResourceURI } = await import('../../src/lib/mcp-oauth-utils.js');

      expect(generateCanonicalResourceURI('https://example.com/'))
        .toBe('https://example.com/'); // Root slash is preserved
      
      expect(generateCanonicalResourceURI('https://example.com/path/'))
        .toBe('https://example.com/path');
    });

    it('should preserve query parameters', async () => {
      const { generateCanonicalResourceURI } = await import('../../src/lib/mcp-oauth-utils.js');

      expect(generateCanonicalResourceURI('https://example.com/path?query=value'))
        .toBe('https://example.com/path?query=value');
    });

    it('should handle invalid URLs gracefully', async () => {
      const { generateCanonicalResourceURI } = await import('../../src/lib/mcp-oauth-utils.js');

      expect(() => generateCanonicalResourceURI('invalid-url'))
        .toThrow();
    });
  });

  describe('generateSecureState', () => {
    it('should generate a valid state parameter', async () => {
      const { generateSecureState } = await import('../../src/lib/mcp-oauth-utils.js');
      
      const state = generateSecureState();

      expect(typeof state).toBe('string');
      expect(state.length).toBeGreaterThan(20);
      expect(state).toMatch(/^[A-Za-z0-9\-._~]+$/);
    });

    it('should generate different state values on each call', async () => {
      const { generateSecureState } = await import('../../src/lib/mcp-oauth-utils.js');
      
      const state1 = generateSecureState();
      const state2 = generateSecureState();

      expect(state1).not.toBe(state2);
    });
  });

  describe('parseWWWAuthenticateHeader', () => {
    it('should parse basic WWW-Authenticate header', async () => {
      const { parseWWWAuthenticateHeader } = await import('../../src/lib/mcp-oauth-utils.js');
      
      const header = 'Bearer realm="WordPress API", error="invalid_token"';
      const parsed = parseWWWAuthenticateHeader(header);

      expect(parsed.scheme).toBe('Bearer');
      expect(parsed.realm).toBe('WordPress API');
      expect(parsed.error).toBe('invalid_token');
    });

    it('should handle complex WWW-Authenticate headers', async () => {
      const { parseWWWAuthenticateHeader } = await import('../../src/lib/mcp-oauth-utils.js');
      
      const header = 'Bearer realm="API", scope="read write", error="insufficient_scope", error_description="The request requires higher privileges"';
      const parsed = parseWWWAuthenticateHeader(header);

      expect(parsed.scheme).toBe('Bearer');
      expect(parsed.realm).toBe('API');
      expect(parsed.scope).toBe('read write');
      expect(parsed.error).toBe('insufficient_scope');
      expect(parsed.error_description).toBe('The request requires higher privileges');
    });

    it('should handle headers without quotes by not parsing unquoted values', async () => {
      const { parseWWWAuthenticateHeader } = await import('../../src/lib/mcp-oauth-utils.js');
      
      const header = 'Bearer error=invalid_token';
      const parsed = parseWWWAuthenticateHeader(header);

      expect(parsed.scheme).toBe('Bearer');
      expect(parsed.error).toBeUndefined(); // Unquoted values are not parsed
    });

    it('should handle malformed headers gracefully', async () => {
      const { parseWWWAuthenticateHeader } = await import('../../src/lib/mcp-oauth-utils.js');
      
      const header = 'Invalid Header Format';
      const parsed = parseWWWAuthenticateHeader(header);

      expect(parsed.scheme).toBe('Invalid'); // Only takes first word as scheme
    });
  });

  describe('buildAuthorizationUrl', () => {
    it('should build a proper authorization URL', async () => {
      const { buildAuthorizationUrl } = await import('../../src/lib/mcp-oauth-utils.js');
      
      const url = buildAuthorizationUrl(
        'https://public-api.wordpress.com/oauth2/authorize',
        'test_client_id',
        'http://localhost:3000/callback',
        ['global'],
        'test_state',
        'test_challenge'
      );

      const urlObj = new URL(url);

      expect(urlObj.origin + urlObj.pathname).toBe('https://public-api.wordpress.com/oauth2/authorize');
      expect(urlObj.searchParams.get('response_type')).toBe('code');
      expect(urlObj.searchParams.get('client_id')).toBe('test_client_id');
      expect(urlObj.searchParams.get('redirect_uri')).toBe('http://localhost:3000/callback');
      expect(urlObj.searchParams.get('scope')).toBe('global');
      expect(urlObj.searchParams.get('state')).toBe('test_state');
      expect(urlObj.searchParams.get('code_challenge')).toBe('test_challenge');
      expect(urlObj.searchParams.get('code_challenge_method')).toBe('S256');
    });
  });

  describe('validateTokenAudience', () => {
    it('should validate token audience correctly', async () => {
      const { validateTokenAudience } = await import('../../src/lib/mcp-oauth-utils.js');
      
      const token = {
        access_token: 'test_token',
        audience: 'https://api.example.com',
      };

      expect(validateTokenAudience(token, 'https://api.example.com')).toBe(true);
      expect(validateTokenAudience(token, 'https://api.different.com')).toBe(false);
    });

    it('should handle tokens without audience', async () => {
      const { validateTokenAudience } = await import('../../src/lib/mcp-oauth-utils.js');
      
      const token = {
        access_token: 'test_token',
      };

      expect(validateTokenAudience(token, 'https://api.example.com')).toBe(true);
    });
  });
});