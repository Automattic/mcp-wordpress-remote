/**
 * OAuth-related HTML used by the callback server and dev preview.
 * Kept separate so `dev:oauth-html` can bundle without the full MCP stack.
 *
 * Visual style aligns with Automattic’s public pages (e.g. Press) — clean editorial
 * layout, neutral background, readable type. See https://automattic.com/press/
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Shared CSS for OAuth static pages — consistent with automattic.com editorial styling
 * (light canvas, high-contrast body text, blue interactive accents).
 */
export const OAUTH_PAGE_SHARED_CSS = `
  .a8c-oauth-page {
    box-sizing: border-box;
    margin: 0;
    min-height: 100vh;
    padding: clamp(1.5rem, 5vw, 3rem) 1.25rem;
    background: #fafafa;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu,
      Cantarell, "Helvetica Neue", sans-serif;
    font-size: 16px;
    line-height: 1.65;
    color: #1d2327;
    -webkit-font-smoothing: antialiased;
  }
  .a8c-oauth-page *,
  .a8c-oauth-page *::before,
  .a8c-oauth-page *::after {
    box-sizing: border-box;
  }
  .a8c-oauth-wrap {
    max-width: 40rem;
    margin: 0 auto;
  }
  .a8c-oauth-card {
    background: #fff;
    border: 1px solid #dcdcde;
    border-radius: 2px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    padding: clamp(1.75rem, 4vw, 2.5rem);
  }
  .a8c-oauth-card--center {
    text-align: center;
  }
  .a8c-oauth-title {
    margin: 0 0 0.75rem;
    font-size: clamp(1.375rem, 2.5vw, 1.625rem);
    font-weight: 600;
    line-height: 1.25;
    color: #101517;
    letter-spacing: -0.02em;
  }
  .a8c-oauth-lead {
    margin: 0 0 1rem;
    font-size: 1rem;
    color: #50575e;
  }
  .a8c-oauth-lead:last-child {
    margin-bottom: 0;
  }
  .a8c-oauth-site {
    font-weight: 600;
    color: #1d2327;
    word-break: break-word;
  }
  .a8c-oauth-notice {
    margin: 1.5rem 0;
    padding: 1rem 1.125rem;
    background: #f0f6fc;
    border-left: 4px solid #3858e9;
    font-size: 0.9375rem;
    color: #1d2327;
    line-height: 1.55;
  }
  .a8c-oauth-actions {
    margin: 1.5rem 0 0;
  }
  .a8c-oauth-btn {
    display: inline-block;
    padding: 0.625rem 1.25rem;
    background: #3858e9;
    color: #fff !important;
    text-decoration: none;
    border-radius: 2px;
    font-weight: 600;
    font-size: 0.9375rem;
    line-height: 1.4;
    border: none;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .a8c-oauth-btn:hover {
    background: #213fd4;
  }
  .a8c-oauth-btn:focus-visible {
    outline: 2px solid #3858e9;
    outline-offset: 2px;
  }
  .a8c-oauth-muted {
    margin: 1.25rem 0 0;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: #646970;
  }
  .a8c-oauth-code {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.8125rem;
    color: #50575e;
    word-break: break-all;
  }
  .a8c-oauth-footer-note {
    margin: 1.5rem 0 0;
    font-size: 0.8125rem;
    color: #787c82;
    text-align: center;
    max-width: 40rem;
    margin-left: auto;
    margin-right: auto;
  }
  .a8c-oauth-spinner {
    border: 3px solid #dcdcde;
    border-top-color: #3858e9;
    border-radius: 50%;
    width: 2rem;
    height: 2rem;
    animation: a8c-oauth-spin 0.85s linear infinite;
    margin: 0 auto 1rem;
  }
  @keyframes a8c-oauth-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .a8c-oauth-status {
    font-size: 1rem;
    font-weight: 500;
    margin: 0.5rem 0;
  }
  .a8c-oauth-status--loading {
    color: #50575e;
  }
  .a8c-oauth-status--success {
    color: #008a20;
  }
  .a8c-oauth-status--error {
    color: #d63638;
  }
  .a8c-oauth-details {
    margin-top: 0.75rem;
    font-size: 0.875rem;
    line-height: 1.5;
    color: #646970;
  }
  .a8c-oauth-dev-index a {
    color: #3858e9;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .a8c-oauth-dev-index a:hover {
    color: #213fd4;
  }
  .a8c-oauth-dev-index ul {
    margin: 1rem 0 0;
    padding-left: 1.25rem;
    line-height: 1.75;
    color: #50575e;
  }
  .a8c-oauth-dev-note {
    margin-top: 1.5rem;
    font-size: 0.875rem;
    color: #646970;
  }
`;

export function buildOAuthLandingHtml(authUrl: string, siteLabel: string): string {
  const safeUrl = escapeHtml(authUrl);
  const safeSite = escapeHtml(siteLabel);
  let authHost = '';
  try {
    authHost = escapeHtml(new URL(authUrl).hostname);
  } catch {
    /* ignore */
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Continue to WordPress authorization</title>
  <style>${OAUTH_PAGE_SHARED_CSS}</style>
</head>
<body class="a8c-oauth-page">
  <div class="a8c-oauth-wrap">
    <main class="a8c-oauth-card" role="main">
      <h1 class="a8c-oauth-title">Connect WordPress</h1>
      <p class="a8c-oauth-lead">MCP WordPress Remote on your computer is asking to sign in so it can access your site.</p>
      <p class="a8c-oauth-lead">Site: <span class="a8c-oauth-site">${safeSite}</span></p>
      ${
        authHost
          ? `<p class="a8c-oauth-muted" style="margin-top:0">You will be sent to <strong>${authHost}</strong> to approve access.</p>`
          : ''
      }
      <div class="a8c-oauth-notice">
        Only click below if <strong>you</strong> just started this from your AI assistant or terminal on this machine.
        If this tab opened unexpectedly, close it.
      </div>
      <p class="a8c-oauth-actions"><a class="a8c-oauth-btn" href="${safeUrl}">Continue to authorization</a></p>
      <p class="a8c-oauth-muted">This page is served only from your device (<span class="a8c-oauth-code">127.0.0.1</span>). It is not hosted by WordPress.com or your site.</p>
    </main>
  </div>
</body>
</html>`;
}

export function buildLandingUnavailableHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorization unavailable</title>
  <style>${OAUTH_PAGE_SHARED_CSS}</style>
</head>
<body class="a8c-oauth-page">
  <div class="a8c-oauth-wrap">
    <main class="a8c-oauth-card" role="main">
      <h1 class="a8c-oauth-title">Session not ready</h1>
      <p class="a8c-oauth-lead">This authorization step has expired or was already completed. Close this tab and start sign-in again from your AI assistant.</p>
    </main>
  </div>
</body>
</html>`;
}

/**
 * HTML page for handling OAuth 2.1 authorization code callback (and implicit flow client JS).
 * MCP Authorization specification 2025-06-18 compliance.
 */
export const AUTHORIZATION_CODE_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MCP Client Authorization</title>
    <style>${OAUTH_PAGE_SHARED_CSS}</style>
</head>
<body class="a8c-oauth-page">
    <div class="a8c-oauth-wrap">
    <main class="a8c-oauth-card a8c-oauth-card--center" role="main">
        <h1 class="a8c-oauth-title">MCP Client Authorization</h1>
        <div class="a8c-oauth-spinner" id="spinner" aria-hidden="true"></div>
        <div id="status" class="a8c-oauth-status a8c-oauth-status--loading" role="status">Processing authorization code…</div>
        <div id="details" class="a8c-oauth-details"></div>
    </main>
    </div>

    <script>
        function displayStatus(message, type = 'loading') {
            const statusEl = document.getElementById('status');
            const spinnerEl = document.getElementById('spinner');
            
            statusEl.textContent = message;
            statusEl.className = 'a8c-oauth-status a8c-oauth-status--' + type;
            
            if (type !== 'loading') {
                spinnerEl.style.display = 'none';
            }
        }

        function displayDetails(message) {
            document.getElementById('details').textContent = message;
        }

        // Handle both OAuth 2.1 authorization code flow and implicit flow
        const urlParams = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.substring(1));

        // Check for authorization code first (OAuth 2.1 flow)
        if (urlParams.has('code')) {
            const authData = {
                code: urlParams.get('code'),
                state: urlParams.get('state'),
                // Additional parameters for validation
                iss: urlParams.get('iss'),
            };

            // Send authorization code to server for token exchange
            fetch('/oauth/callback', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(authData)
            })
            .then(response => {
                if (response.ok) {
                    displayStatus('Authorization successful.', 'success');
                    displayDetails('You can safely close this window.');
                } else {
                    return response.json().then(err => {
                        throw new Error(err.error || 'Failed to exchange authorization code');
                    });
                }
            })
            .catch(error => {
                displayStatus('Error completing authorization', 'error');
                displayDetails(error.message + '. Please try again.');
            });
        } 
        // Check for access token in URL fragment (implicit flow)
        else if (hashParams.has('access_token')) {
            const tokens = {
                access_token: hashParams.get('access_token'),
                token_type: hashParams.get('token_type') || 'Bearer',
                expires_in: hashParams.get('expires_in') ? parseInt(hashParams.get('expires_in')) : 3600,
                scope: hashParams.get('scope'),
                state: hashParams.get('state'),
                obtained_at: Date.now()
            };

            // Send tokens to server for storage
            fetch('/oauth/tokens', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(tokens)
            })
            .then(response => {
                if (response.ok) {
                    displayStatus('Authorization successful.', 'success');
                    displayDetails('You can safely close this window.');
                } else {
                    return response.json().then(err => {
                        throw new Error(err.error || 'Failed to store access token');
                    });
                }
            })
            .catch(error => {
                displayStatus('Error completing authorization', 'error');
                displayDetails(error.message + '. Please try again.');
            });
        } 
        // Check for errors in query parameters
        else if (urlParams.has('error')) {
            const error = urlParams.get('error');
            const errorDescription = urlParams.get('error_description');
            displayStatus('Authorization failed', 'error');
            displayDetails(\`Error: \${error}\${errorDescription ? ' — ' + errorDescription : ''}\`);
        } 
        // Check for errors in URL fragment (implicit flow errors)
        else if (hashParams.has('error')) {
            const error = hashParams.get('error');
            const errorDescription = hashParams.get('error_description');
            displayStatus('Authorization failed', 'error');
            displayDetails(\`Error: \${error}\${errorDescription ? ' — ' + errorDescription : ''}\`);
        } 
        // No authorization code or access token found
        else {
            displayStatus('No authorization code or access token received', 'error');
            displayDetails('Please try the authorization process again.');
        }
    </script>
</body>
</html>
`;
