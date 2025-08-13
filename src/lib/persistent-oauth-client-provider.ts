import open from 'open';
import { EventEmitter } from 'node:events';
import {
  generateServerUrlHash,
  readTokens,
  writeTokens,
  readClientInfo,
  writeClientInfo,
  writeTextFile,
  readTextFile,
  deleteConfigFile,
  isTokenValid,
} from './persistent-auth-config.js';
import { WPTokens, WPClientInfo, OAuthError, WPOAuthOptions } from './oauth-types.js';
import { setupWPOAuthCallbackServer } from './oauth-callback-server.js';
import { logger } from './utils.js';
import { CONFIG, isWordPressComSite, getRecommendedOAuthConfig } from './config.js';

/**
 * WordPress OAuth configuration for persistent storage
 */
const WP_PERSISTENT_CONFIG = {
  authorizeEndpoint: '/wp-admin/admin.php?page=mcp-oauth-authorize',
  scopes: ['read', 'write'],
  callbackPort: CONFIG.OAUTH_CALLBACK_PORT,
  host: CONFIG.OAUTH_HOST,
};

/**
 * Persistent WordPress OAuth Client Provider
 * Stores tokens permanently in ~/.mcp-auth/wordpress-remote-{version}/
 */
export class PersistentWPOAuthClientProvider {
  private options: WPOAuthOptions;
  private serverUrlHash: string;
  private events: EventEmitter;
  private authPromise: Promise<WPTokens> | null = null;

  constructor(options: Partial<WPOAuthOptions>) {
    // Determine the correct OAuth configuration based on site type
    const isWpCom = isWordPressComSite(options.serverUrl || '');
    const recommendedConfig = getRecommendedOAuthConfig(options.serverUrl || '');
    
    this.options = {
      ...WP_PERSISTENT_CONFIG,
      ...options,
    } as WPOAuthOptions;

    // Override authorize endpoint for WordPress.com sites
    if (isWpCom && recommendedConfig.authorizationEndpoint) {
      this.options.authorizeEndpoint = recommendedConfig.authorizationEndpoint;
      logger.debug('Using WordPress.com OAuth endpoint', 'OAUTH', {
        endpoint: recommendedConfig.authorizationEndpoint
      });
    }

    this.serverUrlHash = generateServerUrlHash(this.options.serverUrl);
    this.events = new EventEmitter();

    // Set reasonable timeout for auth operations
    this.events.setMaxListeners(10);

    logger.oauth('Initialized Persistent WordPress OAuth provider');
    logger.debug('OAuth provider options', 'OAUTH', {
      serverUrl: this.options.serverUrl,
      serverHash: this.serverUrlHash,
      clientId: this.options.clientId || 'auto-generated',
      callbackPort: this.options.callbackPort,
      authorizeEndpoint: this.options.authorizeEndpoint,
      isWordPressCom: isWpCom,
    });
  }

  /**
   * Get current tokens if available and valid from persistent storage
   */
  async tokens(): Promise<WPTokens | null> {
    try {
      const tokens = await readTokens(this.serverUrlHash);
      if (tokens) {
        const validation = isTokenValid(tokens);
        if (validation.isValid) {
          logger.oauth('Found valid tokens in persistent storage');
          if (validation.expiresIn) {
            logger.debug(`Tokens expire in ${validation.expiresIn} seconds`, 'OAUTH');
          }
          return tokens;
        } else {
          logger.warn(`Tokens in persistent storage are invalid: ${validation.error}`, 'OAUTH');
          return null;
        }
      }

      logger.debug('No tokens found in persistent storage', 'OAUTH');
      return null;
    } catch (error) {
      logger.error('Error retrieving tokens from persistent storage', 'OAUTH', error);
      return null;
    }
  }

  /**
   * Save tokens to persistent storage
   */
  async saveTokens(tokens: WPTokens): Promise<void> {
    try {
      await writeTokens(this.serverUrlHash, tokens);
      logger.oauth('Tokens saved to persistent storage');
    } catch (error) {
      logger.error('Error saving tokens to persistent storage', 'OAUTH', error);
      throw error;
    }
  }

  /**
   * Get client information from persistent storage
   */
  async clientInformation(): Promise<WPClientInfo | null> {
    try {
      const clientInfo = await readClientInfo(this.serverUrlHash);
      if (clientInfo) {
        logger.debug('Found client information in persistent storage', 'OAUTH');
        return clientInfo;
      }

      logger.debug('No client information found in persistent storage', 'OAUTH');
      return null;
    } catch (error) {
      logger.error('Error retrieving client information', 'OAUTH', error);
      return null;
    }
  }

  /**
   * Save client information to persistent storage
   */
  async saveClientInformation(clientInfo: WPClientInfo): Promise<void> {
    try {
      await writeClientInfo(this.serverUrlHash, clientInfo);
      logger.oauth('Client information saved to persistent storage');
    } catch (error) {
      logger.error('Error saving client information', 'OAUTH', error);
      throw error;
    }
  }

  /**
   * Save PKCE code verifier
   */
  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    try {
      await writeTextFile(this.serverUrlHash, 'code_verifier.txt', codeVerifier);
      logger.debug('Code verifier saved', 'OAUTH');
    } catch (error) {
      logger.error('Error saving code verifier', 'OAUTH', error);
      throw error;
    }
  }

  /**
   * Get PKCE code verifier
   */
  async codeVerifier(): Promise<string> {
    try {
      const verifier = await readTextFile(
        this.serverUrlHash,
        'code_verifier.txt',
        'No code verifier saved for session'
      );
      logger.debug('Code verifier retrieved', 'OAUTH');
      return verifier;
    } catch (error) {
      logger.error('Error retrieving code verifier', 'OAUTH', error);
      throw error;
    }
  }

  /**
   * Initiate OAuth authorization flow
   */
  async authorize(): Promise<void> {
    // If authorization is already in progress, wait for it
    if (this.authPromise) {
      logger.oauth('Authorization already in progress, waiting...');
      await this.authPromise;
      return;
    }

    // Check if we already have valid tokens in persistent storage
    const existingTokens = await this.tokens();
    if (existingTokens) {
      logger.oauth('Already have valid tokens in persistent storage, skipping authorization');
      return;
    }

    logger.oauth('Starting OAuth authorization flow for WordPress (persistent storage)');

    this.authPromise = this.performAuthorization();

    try {
      await this.authPromise;
      logger.oauth('OAuth authorization completed successfully');
    } catch (error) {
      logger.error('OAuth authorization failed', 'OAUTH', error);
      throw error;
    } finally {
      this.authPromise = null;
    }
  }

  /**
   * Perform the actual OAuth authorization
   */
  private async performAuthorization(): Promise<WPTokens> {
    const callbackServerOptions = {
      port: this.options.callbackPort,
      host: this.options.host,
      serverUrlHash: this.serverUrlHash,
      timeout: CONFIG.OAUTH_TIMEOUT,
    };

    logger.oauth(`Setting up callback server on ${this.options.host}:${this.options.callbackPort}`);
    const callbackServer = setupWPOAuthCallbackServer(callbackServerOptions, this.events);

    try {
      // Start the callback server
      logger.oauth('Starting callback server...');
      await callbackServer.start();
      logger.oauth('Callback server started successfully');

      // Generate state parameter for security
      const state = this.generateState();
      logger.debug(`Generated state parameter: ${state}`, 'OAUTH');

      // Build authorization URL
      const authUrl = this.buildAuthorizationUrl(callbackServer.getCallbackUrl(), state);

      logger.oauth(`Built authorization URL: ${authUrl}`);
      logger.debug(`Callback URL: ${callbackServer.getCallbackUrl()}`, 'OAUTH');

      // Open browser to authorization URL
      logger.oauth('Attempting to open browser...');
      try {
        await open(authUrl);
        logger.oauth('Browser opened successfully');
      } catch (browserError) {
        logger.error('Failed to open browser automatically', 'OAUTH', browserError);
        logger.info('\n=== MANUAL ACTION REQUIRED ===');
        logger.info('Please manually open the following URL in your browser:');
        logger.info(`${authUrl}`);
        logger.info('===============================\n');
        // Don't throw here, continue waiting for manual authorization
      }

      // Wait for authorization result
      logger.oauth('Waiting for authorization result...');
      const tokens = await this.waitForAuthorizationResult();
      logger.oauth('Authorization result received');

      // Save tokens to persistent storage
      logger.oauth('Saving tokens to persistent storage...');
      await this.saveTokens(tokens);
      logger.oauth('Tokens saved successfully');

      return tokens;
    } catch (error) {
      logger.error('Error during authorization flow', 'OAUTH', error);
      if (error instanceof Error && error.stack) {
        logger.debug('Stack trace', 'OAUTH', error.stack);
      }
      throw error;
    } finally {
      // Always stop the callback server
      logger.oauth('Stopping callback server...');
      try {
        await callbackServer.stop();
        logger.oauth('Callback server stopped');
      } catch (stopError) {
        logger.error('Error stopping callback server', 'OAUTH', stopError);
      }
    }
  }

  /**
   * Build the WordPress authorization URL
   */
  private buildAuthorizationUrl(callbackUrl: string, state: string): string {
    const authEndpoint = this.options.authorizeEndpoint || WP_PERSISTENT_CONFIG.authorizeEndpoint;

    const params = new URLSearchParams({
      response_type: 'token', // Implicit flow
      redirect_uri: callbackUrl,
      scope: this.options.scopes?.join(' ') || WP_PERSISTENT_CONFIG.scopes.join(' '),
      state: state,
    });

    // Add client_id if provided
    if (this.options.clientId) {
      params.set('client_id', this.options.clientId);
    }

    // Check if authEndpoint is a full URL (for WordPress.com) or relative path (for self-hosted)
    if (authEndpoint.startsWith('http://') || authEndpoint.startsWith('https://')) {
      // Full URL - use as is (WordPress.com case)
      return `${authEndpoint}?${params.toString()}`;
    } else {
      // Relative path - construct with base URL (self-hosted WordPress case)
      const baseUrl = this.options.serverUrl.replace(/\/+$/, ''); // Remove trailing slashes
      return `${baseUrl}${authEndpoint}?${params.toString()}`;
    }
  }

  /**
   * Generate a secure state parameter
   */
  private generateState(): string {
    return (
      Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
    );
  }

  /**
   * Wait for authorization result from callback server
   */
  private async waitForAuthorizationResult(): Promise<WPTokens> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new OAuthError('Authorization timeout', 'TIMEOUT'));
      }, CONFIG.LOCK_TIMEOUT);

      const cleanup = () => {
        this.events.removeAllListeners('oauth-success');
        this.events.removeAllListeners('oauth-error');
        clearTimeout(timeout);
      };

      this.events.once('oauth-success', (tokens: WPTokens) => {
        cleanup();
        logger.oauth('OAuth authorization successful for WordPress (persistent storage)');
        resolve(tokens);
      });

      this.events.once('oauth-error', (error: Error) => {
        cleanup();
        logger.error('OAuth authorization error', 'OAUTH', error.message);
        reject(error);
      });
    });
  }

  /**
   * Clear stored tokens and credentials
   */
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier'): Promise<void> {
    logger.oauth(`Invalidating credentials: ${scope}`);

    switch (scope) {
      case 'all':
        await Promise.all([
          deleteConfigFile(this.serverUrlHash, 'client_info.json'),
          deleteConfigFile(this.serverUrlHash, 'tokens.json'),
          deleteConfigFile(this.serverUrlHash, 'code_verifier.txt'),
        ]);
        logger.oauth('All credentials invalidated');
        break;

      case 'client':
        await deleteConfigFile(this.serverUrlHash, 'client_info.json');
        logger.oauth('Client information invalidated');
        break;

      case 'tokens':
        await deleteConfigFile(this.serverUrlHash, 'tokens.json');
        logger.oauth('OAuth tokens invalidated');
        break;

      case 'verifier':
        await deleteConfigFile(this.serverUrlHash, 'code_verifier.txt');
        logger.oauth('Code verifier invalidated');
        break;

      default:
        throw new Error(`Unknown credential scope: ${scope}`);
    }
  }

  /**
   * Get authorization status
   */
  async isAuthorized(): Promise<boolean> {
    const tokens = await this.tokens();
    return tokens !== null;
  }

  /**
   * Get the server URL hash
   */
  getServerUrlHash(): string {
    return this.serverUrlHash;
  }

  /**
   * Get OAuth options
   */
  getOptions(): WPOAuthOptions {
    return { ...this.options };
  }

  /**
   * Redirect to authorization URL (for browser opening)
   */
  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    logger.oauth(`\nPlease authorize this client by visiting:\n${authorizationUrl.toString()}\n`);

    try {
      await open(authorizationUrl.toString());
      logger.oauth('Browser opened automatically.');
    } catch (error) {
      logger.warn(
        'Could not open browser automatically. Please copy and paste the URL above into your browser.',
        'OAUTH'
      );
    }
  }
}
