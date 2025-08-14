/**
 * OAuth callback server for WordPress implicit flow
 */

import express from 'express';
import { Server } from 'node:http';
import { EventEmitter } from 'node:events';
import { OAuthCallbackServerOptions, WPTokens, OAuthError } from './oauth-types.js';
import { writeTokens } from './persistent-auth-config.js';
import { logger } from './utils.js';

/**
 * HTML page for handling OAuth 2.1 authorization code callback
 * Updated for MCP Authorization specification 2025-06-18 compliance
 */
const AUTHORIZATION_CODE_HTML = `
<!DOCTYPE html>
<html>
<head>
    <title>WordPress MCP OAuth Authorization</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 40px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
        <h1>WordPress MCP OAuth Authorization</h1>
        <div class="spinner" id="spinner"></div>
        <div id="status" class="loading">Processing authorization code...</div>
        <div id="details" class="details"></div>
    </div>

    <script>
        function displayStatus(message, type = 'loading') {
            const statusEl = document.getElementById('status');
            const spinnerEl = document.getElementById('spinner');
            
            statusEl.textContent = message;
            statusEl.className = type;
            
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
                    displayStatus('✅ Authorization successful!', 'success');
                    displayDetails('OAuth 2.1 authentication completed. You can now close this window.');
                    // Auto-close after 3 seconds
                    setTimeout(() => {
                        displayDetails('Closing window...');
                        setTimeout(() => window.close(), 1000);
                    }, 3000);
                } else {
                    return response.json().then(err => {
                        throw new Error(err.error || 'Failed to exchange authorization code');
                    });
                }
            })
            .catch(error => {
                displayStatus('❌ Error completing authorization', 'error');
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
                    displayStatus('✅ Authorization successful!', 'success');
                    displayDetails('OAuth authentication completed. You can now close this window.');
                    // Auto-close after 3 seconds
                    setTimeout(() => {
                        displayDetails('Closing window...');
                        setTimeout(() => window.close(), 1000);
                    }, 3000);
                } else {
                    return response.json().then(err => {
                        throw new Error(err.error || 'Failed to store access token');
                    });
                }
            })
            .catch(error => {
                displayStatus('❌ Error completing authorization', 'error');
                displayDetails(error.message + '. Please try again.');
            });
        } 
        // Check for errors in query parameters
        else if (urlParams.has('error')) {
            const error = urlParams.get('error');
            const errorDescription = urlParams.get('error_description');
            displayStatus('❌ Authorization failed', 'error');
            displayDetails(\`Error: \${error}\${errorDescription ? ' - ' + errorDescription : ''}\`);
        } 
        // Check for errors in URL fragment (implicit flow errors)
        else if (hashParams.has('error')) {
            const error = hashParams.get('error');
            const errorDescription = hashParams.get('error_description');
            displayStatus('❌ Authorization failed', 'error');
            displayDetails(\`Error: \${error}\${errorDescription ? ' - ' + errorDescription : ''}\`);
        } 
        // No authorization code or access token found
        else {
            displayStatus('❌ No authorization code or access token received', 'error');
            displayDetails('Please try the authorization process again.');
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

  constructor(options: OAuthCallbackServerOptions, events: EventEmitter) {
    this.options = options;
    this.events = events;
    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Parse JSON bodies
    this.app.use(express.json());

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
    return new Promise(resolve => {
      if (this.server) {
        this.server.close(() => {
          logger.oauth('OAuth callback server stopped');
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
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
