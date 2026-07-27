/**
 * OAuth landing page helpers
 */

import { describe, it, expect } from '@jest/globals';
import { formatSiteLabelForOAuthLanding } from '../../src/lib/oauth-callback-server.js';

describe('formatSiteLabelForOAuthLanding', () => {
  it('returns host for HTTPS URL with path', () => {
    expect(formatSiteLabelForOAuthLanding('https://mysite.com/blog')).toBe('mysite.com');
  });

  it('returns host for URL with port', () => {
    expect(formatSiteLabelForOAuthLanding('http://localhost:8888')).toBe('localhost:8888');
  });

  it('returns original string when URL is invalid', () => {
    expect(formatSiteLabelForOAuthLanding('not-a-valid-url')).toBe('not-a-valid-url');
  });
});
