import { CONFIG, getCustomHeaders } from './config.js';
import { proxyFetch } from './fetch-utils.js';
import { OAuthError } from './oauth-types.js';

export function validateOAuthUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthError('Invalid OAuth URL', 'INVALID_OAUTH_URL');
  }
  const loopback =
    url.hostname === 'localhost' ||
    url.hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new OAuthError(
      'OAuth URLs require HTTPS (HTTP is allowed only on loopback)',
      'INSECURE_OAUTH_URL'
    );
  }
  return url;
}

export async function oauthFetch(value: string, init: RequestInit = {}): Promise<Response> {
  const url = validateOAuthUrl(value);
  const headers = new Headers(
    url.origin === new URL(CONFIG.WP_API_URL).origin ? getCustomHeaders() : {}
  );
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  const response = await proxyFetch(url.toString(), {
    ...init,
    headers,
    redirect: 'error',
    signal: init.signal ?? AbortSignal.timeout(CONFIG.OAUTH_TIMEOUT),
  });
  if (response.status >= 300 && response.status < 400)
    throw new OAuthError('OAuth endpoint redirects are not accepted', 'OAUTH_REDIRECT');
  return response;
}
