import express from 'express';
import { Server } from 'node:http';
import { EventEmitter } from 'node:events';
import { OAuthCallbackServerOptions, WPTokens, OAuthError } from './oauth-types.js';
import { writeTokens } from './persistent-auth-config.js';
import { logger } from './utils.js';

/**
 * HTML page for handling OAuth 2.1 authorization code callback
 * Supports isolated authorization-code and legacy implicit callbacks
 */
const AUTHORIZATION_CODE_HTML = `
<!DOCTYPE html>
<html>
<head>
    <title>MCP Client Authorization</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 40px;
            background: #f5f5f5;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 500px;
            width: 100%;
        }
        h1 {
            color: #333;
            margin-bottom: 20px;
        }
        .success { 
            color: #27ae60; 
            font-size: 18px;
            margin: 20px 0;
        }
        .error { 
            color: #e74c3c; 
            font-size: 18px;
            margin: 20px 0;
        }
        .loading { 
            color: #3498db; 
            font-size: 18px;
            margin: 20px 0;
        }
        .details {
            color: #666;
            margin-top: 10px;
            font-size: 14px;
        }
        .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #3498db;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>MCP Client Authorization</h1>
        <div class="spinner" id="spinner"></div>
        <div id="status" class="loading">Processing authorization code...</div>
        <div id="details" class="details"></div>
    </div>

    <script>
        const query = new URLSearchParams(window.location.search);
        const fragment = new URLSearchParams(window.location.hash.substring(1));
        const status = document.getElementById('status');
        const details = document.getElementById('details');
        const data = Object.fromEntries(query.has('code') || query.has('error') ? query : fragment);
        const endpoint = data.access_token ? '/oauth/tokens' : '/oauth/callback';
        if (data.code || data.error || data.access_token) {
            fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
                .then(async response => {
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.error || 'Authorization response was rejected');
                    status.textContent = data.access_token ? 'Authorization successful' : 'Authorization code received';
                    status.className = 'success';
                    details.textContent = data.access_token ? 'You can close this window.' : 'Return to your app to check the connection. Token exchange may still fail.';
                })
                .catch(error => { status.textContent = 'Authorization failed'; status.className = 'error'; details.textContent = error.message; })
                .finally(() => { document.getElementById('spinner').style.display = 'none'; });
        } else {
            status.textContent = 'No authorization response received';
            document.getElementById('spinner').style.display = 'none';
        }
    </script>
</body>
</html>
`;

export class OAuthCallbackServer {
  private app: express.Application;
  private server: Server | null = null;
  private events: EventEmitter;
  private options: OAuthCallbackServerOptions;
  private startupTimer?: ReturnType<typeof setTimeout>;

  constructor(options: OAuthCallbackServerOptions, events: EventEmitter) {
    this.options = options;
    this.events = events;
    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Parse JSON bodies
    this.app.use((req, res, next) => {
      const host = this.options.host === '::1' ? '[::1]' : this.options.host;
      const origin = req.headers.origin;
      const port = this.server?.address();
      const expectedOrigin = `http://${host}:${port && typeof port !== 'string' ? port.port : this.options.port}`;
      if (req.hostname !== host || (origin && origin !== expectedOrigin)) {
        res.status(403).json({ error: 'Untrusted callback origin' });
        return;
      }
      next();
    });
    this.app.use(express.json());

    // Serve the authorization code callback page
    this.app.get('/oauth/callback', (req, res) => {
      logger.oauth('OAuth 2.1 authorization callback page requested');
      res.send(AUTHORIZATION_CODE_HTML);
    });

    // Handle authorization code from OAuth 2.1 flow
    this.app.post('/oauth/callback', async (req, res) => {
      try {
        const { code, state, iss, error } = req.body;
        this.validateResponse(state, iss);
        if (error) throw new OAuthError('Authorization denied or failed', 'AUTH_DENIED');
        if (this.options.flow === 'implicit')
          throw new OAuthError('Authorization-code callback is disabled', 'WRONG_FLOW');
        if (typeof code !== 'string' || !code)
          throw new OAuthError('No authorization code received', 'INVALID_CODE');
        this.events.emit('oauth-code-received', { code, state, iss });
        res.json({
          success: true,
          message: 'Authorization code received; check connection status in the app',
        });
      } catch (error) {
        const failure =
          error instanceof OAuthError ? error : new OAuthError('Invalid authorization response');
        if (failure.code !== 'INVALID_STATE') this.events.emit('oauth-error', failure);
        res.status(400).json({ error: failure.message });
      }
    });

    this.app.post('/oauth/tokens', async (req, res) => {
      if (this.options.flow !== 'implicit') {
        res.status(404).json({ error: 'Implicit token callback is disabled' });
        return;
      }
      try {
        this.validateResponse(req.body.state, req.body.iss);
        if (
          typeof req.body.access_token !== 'string' ||
          !req.body.access_token ||
          (req.body.token_type && req.body.token_type.toLowerCase() !== 'bearer')
        )
          throw new OAuthError('Invalid implicit token response');
        const tokens: WPTokens = {
          access_token: req.body.access_token,
          token_type: 'Bearer',
          expires_in: req.body.expires_in === undefined ? undefined : Number(req.body.expires_in),
          scope: req.body.scope,
          obtained_at: Date.now(),
        };
        await writeTokens(this.options.serverUrlHash, tokens);
        this.events.emit('oauth-success', tokens);
        res.json({ success: true });
      } catch (error) {
        const failure =
          error instanceof OAuthError ? error : new OAuthError('Invalid implicit response');
        if (failure.code !== 'INVALID_STATE') this.events.emit('oauth-error', failure);
        res.status(400).json({ error: failure.message });
      }
    });

    // Health check endpoint
    this.app.get('/oauth/health', (req, res) => {
      res.json({
        status: 'ok',
        serverHash: this.options.serverUrlHash,
        timestamp: new Date().toISOString(),
      });
    });

    // Error handling middleware
    this.app.use(
      (error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
        logger.error('Express server error', 'OAUTH', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    );
  }

  private validateResponse(state: unknown, issuer: unknown): void {
    if (!this.options.state || state !== this.options.state)
      throw new OAuthError('Invalid callback state', 'INVALID_STATE');
    if ((issuer !== undefined || this.options.requireIssuer) && issuer !== this.options.issuer)
      throw new OAuthError('Invalid callback issuer', 'INVALID_ISSUER');
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.options.port, this.options.host, (error?: Error) => {
          clearTimeout(this.startupTimer);
          // Express 5 also invokes this callback when binding fails.
          if (error) {
            reject(error);
            return;
          }

          logger.oauth(
            `OAuth callback server listening on http://${this.options.host}:${this.options.port}`
          );
          resolve();
        });

        this.server.on('error', (error: Error) => {
          clearTimeout(this.startupTimer);
          logger.error('OAuth callback server error', 'OAUTH', error);
          reject(error);
        });

        // Set timeout for server startup
        if (this.options.timeout) {
          this.startupTimer = setTimeout(() => {
            if (!this.server?.listening) {
              reject(new OAuthError('OAuth callback server startup timeout', 'TIMEOUT'));
            }
          }, this.options.timeout);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    clearTimeout(this.startupTimer);
    if (!this.server) return;
    const server = this.server;
    this.server = null;

    // Browser keep-alive sockets must not delay MCP initialization when the listener closes.
    server.close(err => {
      if (err) logger.error('OAuth callback server close error', 'OAUTH', err);
      else logger.oauth('OAuth callback server stopped');
    });
    server.closeAllConnections?.();
  }

  getCallbackUrl(): string {
    return `http://${this.options.host}:${this.options.port}/oauth/callback`;
  }

  isRunning(): boolean {
    return this.server?.listening ?? false;
  }
}

/**
 * Setup WordPress OAuth callback server
 */
export function setupWPOAuthCallbackServer(
  options: OAuthCallbackServerOptions,
  events: EventEmitter
): OAuthCallbackServer {
  return new OAuthCallbackServer(options, events);
}
