/**
 * Unit tests for connection-error classification in error-utils.
 *
 * Regression coverage for issue #61: TLS-trust failures (mkcert / DDEV /
 * corporate CA) must be recognized so the proxy can surface an actionable
 * hint instead of a silent "connection failed".
 */

import {
  extractNetworkErrorCode,
  extractNetworkErrorMessage,
  getConnectionErrorHint,
  describeConnectionError,
  isTimeoutCode,
  convertAPIErrorToMcpError,
  apiErrorToMcpError,
} from '../../src/lib/error-utils.js';
import { APIError } from '../../src/lib/oauth-types.js';

describe('error-utils connection error classification', () => {
  describe('extractNetworkErrorCode', () => {
    it('reads a code from the top-level error', () => {
      const err = Object.assign(new Error('boom'), { code: 'ECONNREFUSED' });
      expect(extractNetworkErrorCode(err)).toBe('ECONNREFUSED');
    });

    it('walks the cause chain (undici wraps the real error as cause)', () => {
      // Node `fetch` throws TypeError("fetch failed") with the TLS error in .cause
      const tlsError = Object.assign(new Error('self-signed'), {
        code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      });
      const fetchError = Object.assign(new TypeError('fetch failed'), { cause: tlsError });

      expect(extractNetworkErrorCode(fetchError)).toBe('UNABLE_TO_VERIFY_LEAF_SIGNATURE');
    });

    it('returns undefined when no code is present', () => {
      expect(extractNetworkErrorCode(new Error('no code'))).toBeUndefined();
      expect(extractNetworkErrorCode('a string')).toBeUndefined();
    });

    it('stops walking after a bounded depth (no infinite loop on cyclic cause)', () => {
      const a: any = new Error('a');
      const b: any = new Error('b');
      a.cause = b;
      b.cause = a; // cycle, no codes anywhere
      expect(extractNetworkErrorCode(a)).toBeUndefined();
    });
  });

  describe('getConnectionErrorHint', () => {
    it.each([
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
    ])('returns the CA-trust hint for %s', code => {
      const hint = getConnectionErrorHint(code);
      expect(hint).toContain('NODE_EXTRA_CA_CERTS');
      expect(hint).toContain('NODE_USE_SYSTEM_CA');
    });

    it('returns a specific hint for non-trust network codes', () => {
      expect(getConnectionErrorHint('ENOTFOUND')).toMatch(/resolved/i);
      expect(getConnectionErrorHint('ECONNREFUSED')).toMatch(/refused/i);
      expect(getConnectionErrorHint('CERT_HAS_EXPIRED')).toMatch(/expired/i);
    });

    it('returns undefined for unknown or missing codes', () => {
      expect(getConnectionErrorHint('SOMETHING_ELSE')).toBeUndefined();
      expect(getConnectionErrorHint(undefined)).toBeUndefined();
    });
  });

  describe('describeConnectionError', () => {
    it('produces code, message, and hint for a wrapped TLS error', () => {
      const tlsError = Object.assign(new Error('self-signed certificate in certificate chain'), {
        code: 'SELF_SIGNED_CERT_IN_CHAIN',
      });
      const fetchError = Object.assign(new TypeError('fetch failed'), { cause: tlsError });

      const result = describeConnectionError(fetchError);
      expect(result.code).toBe('SELF_SIGNED_CERT_IN_CHAIN');
      expect(result.message).toBe('fetch failed');
      expect(result.hint).toContain('NODE_EXTRA_CA_CERTS');
    });

    it('omits the hint for an unrecognized failure', () => {
      const result = describeConnectionError(new Error('something odd'));
      expect(result.code).toBeUndefined();
      expect(result.message).toBe('something odd');
      expect(result.hint).toBeUndefined();
    });
  });

  describe('isTimeoutCode', () => {
    it.each(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'])(
      'treats %s as a timeout',
      code => {
        expect(isTimeoutCode(code)).toBe(true);
        // Timeout codes also resolve to the timeout hint.
        expect(getConnectionErrorHint(code)).toMatch(/timed out/i);
      }
    );

    it('is false for non-timeout and missing codes', () => {
      expect(isTimeoutCode('ECONNREFUSED')).toBe(false);
      expect(isTimeoutCode(undefined)).toBe(false);
    });
  });

  describe('extractNetworkErrorMessage', () => {
    it('returns the deepest cause message, not the wrapper', () => {
      const leaf = Object.assign(new Error('unable to verify the first certificate'), {
        code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      });
      const wrapper = Object.assign(new TypeError('fetch failed'), { cause: leaf });
      expect(extractNetworkErrorMessage(wrapper)).toBe('unable to verify the first certificate');
    });

    it('falls back to the top-level message when there is no cause', () => {
      expect(extractNetworkErrorMessage(new Error('boom'))).toBe('boom');
      expect(extractNetworkErrorMessage('a string')).toBe('a string');
    });
  });

  describe('MCP error conversion carries the network code and hint', () => {
    it('maps a timeout APIError to the MCP timeout code with code + hint in data', () => {
      const err = new APIError('WordPress API request timed out after 120000ms', 0, 'url', undefined, 'ETIMEDOUT');

      const converted = convertAPIErrorToMcpError(err);
      expect(converted.error.code).toBe(-32001); // TIMEOUT_ERROR
      expect(converted.error.data.code).toBe('ETIMEDOUT');
      expect(converted.error.data.hint).toMatch(/timed out/i);

      const mcpError = apiErrorToMcpError(err);
      expect(mcpError.code).toBe(-32001);
      expect((mcpError.data as any).code).toBe('ETIMEDOUT');
      expect((mcpError.data as any).hint).toMatch(/timed out/i);
    });

    it('falls back to status-based mapping for HTTP errors without a network code', () => {
      const err = new APIError('Unauthorized', 401, 'url', 'body');
      const converted = convertAPIErrorToMcpError(err);
      expect(converted.error.code).toBe(-32010); // UNAUTHORIZED
      expect(converted.error.data.code).toBeUndefined();
      expect(converted.error.data.hint).toBeUndefined();
    });
  });
});
