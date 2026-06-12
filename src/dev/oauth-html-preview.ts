/**
 * Dev-only: serve OAuth HTML flows in the browser without MCP or WordPress.
 *
 * Usage: npm run dev:oauth-html
 * Env: OAUTH_HTML_PREVIEW_HOST (default 127.0.0.1), OAUTH_HTML_PREVIEW_PORT (default 8765).
 * If the preferred port is in use, the next free port is tried (up to +30) and a line is printed.
 */

import http from 'node:http';
import express from 'express';
import type { AddressInfo } from 'node:net';
import {
  buildOAuthLandingHtml,
  buildLandingUnavailableHtml,
  AUTHORIZATION_CODE_HTML,
  OAUTH_PAGE_SHARED_CSS,
} from '../lib/oauth-html-templates.js';

const HOST = process.env.OAUTH_HTML_PREVIEW_HOST || '127.0.0.1';
const PREFERRED_PORT = Number(process.env.OAUTH_HTML_PREVIEW_PORT) || 8765;

/** Query param: authorization code that triggers a simulated failed POST (tests error UI). */
const PREVIEW_FAIL_CODE = '__preview_fail__';

const app = express();
app.use(express.json());

function previewBase(req: express.Request): string {
  const host = req.get('host') || `${HOST}:${PREFERRED_PORT}`;
  return `${req.protocol}://${host}`;
}

function buildMockAuthorizeUrl(base: string): string {
  return (
    'https://public-api.wordpress.com/oauth/authorize?' +
    new URLSearchParams({
      client_id: 'dev_preview',
      response_type: 'code',
      state: 'dev_state',
      redirect_uri: `${base}/oauth/callback`,
    }).toString()
  );
}

app.get('/', (req, res) => {
  const base = previewBase(req);
  const implicitSuccess = `${base}/oauth/callback#access_token=preview_token&token_type=Bearer&expires_in=3600&state=s1`;
  const implicitError = `${base}/oauth/callback#error=access_denied&error_description=User%20cancelled`;
  const portLabel = req.get('host')?.split(':').pop() ?? String(PREFERRED_PORT);

  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OAuth HTML preview (dev)</title>
  <style>${OAUTH_PAGE_SHARED_CSS}</style>
</head>
<body class="a8c-oauth-page">
  <div class="a8c-oauth-wrap a8c-oauth-dev-index">
    <main class="a8c-oauth-card" role="main">
      <h1 class="a8c-oauth-title">OAuth HTML preview</h1>
      <p class="a8c-oauth-lead">Same templates as production (<span class="a8c-oauth-code">oauth-html-templates.ts</span>). POST handlers are mocked (no token storage).</p>
      <ul>
        <li><a href="/oauth/start">Landing page</a> — continue link uses a fake authorize URL</li>
        <li><a href="/preview/unavailable">Session not ready</a> (HTTP 400, same body as production)</li>
        <li><a href="/oauth/callback">Callback shell</a> — no query/hash → &quot;no code&quot; client error</li>
        <li><a href="/oauth/callback?code=mock_code&amp;state=dev_state">Callback</a> — auth code → mock POST success</li>
        <li><a href="/oauth/callback?code=${PREVIEW_FAIL_CODE}&amp;state=x">Callback</a> — simulated POST failure</li>
        <li><a href="/oauth/callback?error=access_denied&amp;error_description=User%20cancelled">Callback</a> — OAuth error (query)</li>
        <li><a href="${implicitSuccess}">Implicit success</a> (hash)</li>
        <li><a href="${implicitError}">Implicit error</a> (hash)</li>
      </ul>
      <p class="a8c-oauth-dev-note">Listening on port <span class="a8c-oauth-code">${portLabel}</span> · Set <span class="a8c-oauth-code">OAUTH_HTML_PREVIEW_PORT</span> for the first port to try.</p>
    </main>
  </div>
</body>
</html>`);
});

app.get('/oauth/start', (req, res) => {
  const base = previewBase(req);
  res.type('html').send(buildOAuthLandingHtml(buildMockAuthorizeUrl(base), 'mysite.wordpress.com'));
});

app.get('/preview/unavailable', (_req, res) => {
  res.status(400).type('html').send(buildLandingUnavailableHtml());
});

app.get('/oauth/callback', (_req, res) => {
  res.type('html').send(AUTHORIZATION_CODE_HTML);
});

app.post('/oauth/callback', (req, res) => {
  const code = req.body?.code as string | undefined;
  if (code === PREVIEW_FAIL_CODE) {
    res.status(400).json({ error: 'Simulated token exchange failure (dev preview)' });
    return;
  }
  res.json({ success: true, message: 'Authorization code received successfully' });
});

app.post('/oauth/tokens', (_req, res) => {
  res.json({ success: true, message: 'Tokens saved successfully' });
});

async function startServer(): Promise<void> {
  const maxPort = PREFERRED_PORT + 30;

  for (let port = PREFERRED_PORT; port <= maxPort; port++) {
    const server = http.createServer(app);
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: NodeJS.ErrnoException) => {
          server.removeListener('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          server.removeListener('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, HOST);
      });

      const addr = server.address() as AddressInfo;
      const actualPort = addr.port;
      if (actualPort !== PREFERRED_PORT) {
        process.stdout.write(`Port ${PREFERRED_PORT} in use; using ${actualPort} instead.\n`);
      }
      process.stdout.write(`OAuth HTML preview → http://${HOST}:${actualPort}/\n`);
      return;
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'EADDRINUSE') {
        server.close();
        continue;
      }
      throw e;
    }
  }

  throw new Error(
    `No free port found between ${PREFERRED_PORT} and ${maxPort} (set OAUTH_HTML_PREVIEW_PORT or free a port)`
  );
}

startServer().catch(err => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
