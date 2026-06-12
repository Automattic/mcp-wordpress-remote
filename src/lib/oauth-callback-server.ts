/**
 * OAuth callback server for WordPress implicit flow
 */

import express from 'express';
import { Server } from 'node:http';
import { EventEmitter } from 'node:events';
import { OAuthCallbackServerOptions, WPTokens, OAuthError } from './oauth-types.js';
import { writeTokens } from './persistent-auth-config.js';
import { logger } from './utils.js';
import {
  buildOAuthLandingHtml,
  buildLandingUnavailableHtml,
  AUTHORIZATION_CODE_HTML,
} from './oauth-html-templates.js';

/**
 * Human-readable site label for the OAuth landing page (hostname preferred).
 */
export function formatSiteLabelForOAuthLanding(serverUrl: string): string {
  try {
    const u = new URL(serverUrl);
    return u.host;
  } catch {
    return serverUrl;
  }
}

export class OAuthCallbackServer {
  private app: express.Application;
  private server: Server | null = null;
  private events: EventEmitter;
  private options: OAuthCallbackServerOptions;
  private landingAuthUrl: string | null = null;
  private landingSiteLabel: string = '';

  constructor(options: OAuthCallbackServerOptions, events: EventEmitter) {
    this.options = options;
    this.events = events;
    this.app = express();
    this.setupRoutes();
  }

  /**
   * Set context for GET /oauth/start (localhost landing page before the OAuth authorize URL).
   * Call after building the authorization URL and before opening the browser.
   */
  setLandingContext(authUrl: string, siteLabel: string): void {
    this.landingAuthUrl = authUrl;
    this.landingSiteLabel = siteLabel;
  }

  /**
   * URL of the localhost landing page (opens in the browser instead of the authorize URL when enabled).
   */
  getLandingUrl(): string {
    return `http://${this.options.host}:${this.options.port}/oauth/start`;
  }

  private setupRoutes(): void {
    // Parse JSON bodies
    this.app.use(express.json());

    // Localhost landing page: user confirms before visiting the OAuth authorize URL
    this.app.get('/oauth/start', (req, res) => {
      logger.oauth('OAuth landing page requested');
      if (!this.landingAuthUrl) {
        res.status(400).type('html').send(buildLandingUnavailableHtml());
        return;
      }
      res.type('html').send(buildOAuthLandingHtml(this.landingAuthUrl, this.landingSiteLabel));
    });

    // Serve the authorization code callback page
    this.app.get('/oauth/callback', (req, res) => {
      logger.oauth('OAuth 2.1 authorization callback page requested');
      res.send(AUTHORIZATION_CODE_HTML);
    });

    // Handle authorization code from OAuth 2.1 flow
    this.app.post('/oauth/callback', async (req, res) => {
      try {
        const { code, state, iss } = req.body;

        if (!code) {
          throw new OAuthError('No authorization code received');
        }

        logger.oauth('OAuth 2.1 authorization code received');
        logger.debug('Authorization code details', 'OAUTH', {
          codeLength: code.length,
          state: state || 'none',
          issuer: iss || 'none',
        });

        // Emit authorization code event for processing
        this.events.emit('oauth-code-received', { code, state, iss });

        res.json({ success: true, message: 'Authorization code received successfully' });
      } catch (error) {
        logger.error('Error processing authorization code', 'OAUTH', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.events.emit('oauth-error', new OAuthError(errorMessage));
        res.status(400).json({ error: errorMessage });
      }
    });

    // Legacy endpoint for backward compatibility (tokens endpoint for implicit flow)
    this.app.post('/oauth/tokens', async (req, res) => {
      try {
        const tokens = req.body as WPTokens;

        if (!tokens.access_token) {
          throw new OAuthError('No access token received');
        }

        logger.oauth('Legacy OAuth tokens received (implicit flow)');
        logger.debug('Token details', 'OAUTH', {
          tokenType: tokens.token_type,
          expiresIn: tokens.expires_in,
          scope: tokens.scope,
          tokenLength: tokens.access_token.length,
        });

        // Store the tokens
        await writeTokens(this.options.serverUrlHash, tokens);

        // Emit success event
        this.events.emit('oauth-success', tokens);

        res.json({ success: true, message: 'Tokens saved successfully' });
      } catch (error) {
        logger.error('Error processing OAuth tokens', 'OAUTH', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.events.emit('oauth-error', new OAuthError(errorMessage));
        res.status(400).json({ error: errorMessage });
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

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.options.port, this.options.host, () => {
          logger.oauth(
            `OAuth callback server listening on http://${this.options.host}:${this.options.port}`
          );
          resolve();
        });

        this.server.on('error', (error: Error) => {
          logger.error('OAuth callback server error', 'OAUTH', error);
          reject(error);
        });

        // Set timeout for server startup
        if (this.options.timeout) {
          setTimeout(() => {
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
    this.landingAuthUrl = null;
    this.landingSiteLabel = '';
    if (!this.server) return;
    const server = this.server;
    this.server = null;

    // Fire-and-forget. By the time stop() is called we already have the auth
    // code and persisted tokens, so the callback server has no further role.
    // Waiting for http.Server.close()'s callback would gate MCP initialization
    // on every socket draining, and browsers hold the OAuth callback socket
    // via HTTP/1.1 keep-alive for up to ~60s — long enough to trip the MCP
    // client's 30s connect timeout on the very first run. Initiate close
    // and force-sever remaining sockets; logging happens when the callback
    // eventually fires in the background.
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
