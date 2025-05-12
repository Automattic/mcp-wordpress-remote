import open from 'open';
import { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  readJsonFile,
  writeJsonFile,
  readTextFile,
  writeTextFile,
  getConfigFilePath,
} from './wp-auth-config';
import { getServerUrlHash, log } from './utils';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import { createLazyAuthCoordinator, AuthCoordinator } from './coordination';

export interface OAuthProviderOptions {
  serverUrl: string;
  callbackPort: number;
  callbackPath?: string;
  clientName?: string;
  clientUri?: string;
  softwareId?: string;
  softwareVersion?: string;
  clientSecret?: string;
}

/**
 * Implements the OAuthClientProvider interface for WordPress MCP.
 * Handles OAuth flow and token storage.
 */
export class WordPressOAuthProvider implements OAuthClientProvider {
  private serverUrlHash: string;
  private callbackPath: string;
  private clientName: string;
  private clientUri: string;
  private softwareId: string;
  private softwareVersion: string;
  private clientSecret: string;
  private authCoordinator: AuthCoordinator;
  private events: EventEmitter;
  private currentState: string | null = null;

  /**
   * Creates a new WordPressOAuthProvider
   * @param options Configuration options for the provider
   */
  constructor(readonly options: OAuthProviderOptions) {
    this.serverUrlHash = getServerUrlHash(options.serverUrl);
    this.callbackPath = options.callbackPath || '/oauth/callback';
    this.clientName = options.clientName || 'WordPress MCP Client';
    this.clientUri = options.clientUri || 'https://github.com/Automattic/mcp-wordpress-remote';
    this.softwareId = options.softwareId || process.env.WP_OAUTH_CLIENT_ID || '';
    this.softwareVersion = options.softwareVersion || '0.1.10';
    this.clientSecret = options.clientSecret || '';
    this.events = new EventEmitter();
    this.authCoordinator = createLazyAuthCoordinator(
      this.serverUrlHash,
      this.options.callbackPort,
      this.events
    );

    // Validate required OAuth credentials
    if (!this.softwareId) {
      throw new Error(
        'Client ID is required. Please set WP_OAUTH_CLIENT_ID environment variable or provide softwareId in options.'
      );
    }
    if (!this.clientSecret) {
      throw new Error(
        'Client Secret is required. Please set WP_OAUTH_CLIENT_SECRET environment variable or provide clientSecret in options.'
      );
    }
  }

  get redirectUrl(): string {
    return `http://127.0.0.1:${this.options.callbackPort}${this.callbackPath}`;
  }

  get clientMetadata() {
    return {
      redirect_uris: [this.redirectUrl],
      token_endpoint_auth_method: 'client_secret_basic',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: this.clientName,
      client_uri: this.clientUri,
      software_id: this.softwareId,
      software_version: this.softwareVersion,
    };
  }

  /**
   * Initializes the authentication process
   * @returns The authentication state
   */
  async initializeAuth() {
    try {
      const authState = await this.authCoordinator.initializeAuth();

      // If we don't need to skip browser auth, trigger the authorization flow
      if (!authState.skipBrowserAuth) {
        // Get the authorization URL from WordPress.com
        const authUrl = new URL('https://public-api.wordpress.com/oauth2/authorize');
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', this.softwareId);
        authUrl.searchParams.set('redirect_uri', this.redirectUrl);
        authUrl.searchParams.set('scope', 'global');

        // Redirect to authorization
        await this.redirectToAuthorization(authUrl);
      }

      return authState;
    } catch (error) {
      log('Failed to initialize auth:', error);
      throw error;
    }
  }

  /**
   * Gets the client information if it exists
   * @returns The client information or undefined
   */
  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    try {
      return await readJsonFile<OAuthClientInformation>(this.serverUrlHash, 'client_info.json');
    } catch (error) {
      log('Failed to read client information:', error);
      return undefined;
    }
  }

  /**
   * Saves client information
   * @param clientInformation The client information to save
   */
  async saveClientInformation(clientInformation: OAuthClientInformationFull): Promise<void> {
    try {
      await writeJsonFile(this.serverUrlHash, 'client_info.json', clientInformation);
    } catch (error) {
      log('Failed to save client information:', error);
      throw error;
    }
  }

  /**
   * Gets the OAuth tokens if they exist
   * @returns The OAuth tokens or undefined
   */
  async tokens(): Promise<OAuthTokens | undefined> {
    try {
      log('Attempting to read tokens from:', getConfigFilePath(this.serverUrlHash, 'tokens.json'));
      const tokens = await readJsonFile<OAuthTokens>(this.serverUrlHash, 'tokens.json');
      log('Read tokens:', tokens);
      if (tokens && this.validateTokens(tokens)) {
        log('Tokens are valid');
        return tokens;
      }
      log('Tokens are invalid or missing');
      return undefined;
    } catch (error) {
      log('Failed to read tokens:', error);
      return undefined;
    }
  }

  /**
   * Saves OAuth tokens
   * @param tokens The tokens to save
   */
  async saveTokens(tokens: OAuthTokens): Promise<void> {
    try {
      log('Saving tokens to:', getConfigFilePath(this.serverUrlHash, 'tokens.json'));
      await writeJsonFile(this.serverUrlHash, 'tokens.json', tokens);
      log('Successfully saved tokens');
    } catch (error) {
      log('Failed to save tokens:', error);
      throw error;
    }
  }

  /**
   * Redirects the user to the authorization URL
   * @param authorizationUrl The URL to redirect to
   */
  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    try {
      // Generate and store state for validation
      this.currentState = this.generateState();
      const urlWithState = new URL(authorizationUrl);
      urlWithState.searchParams.set('state', this.currentState);

      log(`\nPlease authorize this client by visiting:\n${urlWithState.toString()}\n`);
      await open(urlWithState.toString());
      log('Browser opened automatically.');
    } catch (error) {
      log(
        'Could not open browser automatically. Please copy and paste the URL above into your browser.'
      );
      throw new Error('Failed to open browser for authorization');
    }
  }

  /**
   * Validates the state parameter from the callback
   * @param receivedState The state received from the callback
   * @returns True if the state is valid
   */
  validateState(receivedState: string): boolean {
    if (!this.currentState) {
      log('No state parameter was set for this authorization request');
      return false;
    }
    const isValid = this.currentState === receivedState;
    this.currentState = null; // Clear the state after validation
    return isValid;
  }

  /**
   * Generates a random state parameter
   * @returns A random state string
   */
  private generateState(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Validates OAuth tokens
   * @param tokens The tokens to validate
   * @returns True if the tokens are valid
   */
  private validateTokens(tokens: OAuthTokens): boolean {
    if (!tokens.access_token) {
      return false;
    }

    return true;
  }

  /**
   * Exchanges an authorization code for access and refresh tokens
   * @param code The authorization code to exchange
   * @returns The OAuth tokens
   */
  async exchangeCodeForTokens(code: string): Promise<OAuthTokens> {
    try {
      log('Exchanging code for tokens...');
      const tokenUrl = new URL('https://public-api.wordpress.com/oauth2/token');
      log('Token URL:', tokenUrl.toString());

      const response = await fetch(tokenUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${this.softwareId}:${this.clientSecret}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: this.redirectUrl,
          client_id: this.softwareId,
          client_secret: this.clientSecret,
        }).toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        log('Token exchange failed:', errorText);
        throw new Error(
          `Token exchange failed: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = (await response.json()) as {
        access_token: string;
        token_type: string;
        expires_in: number;
        scope: string;
        refresh_token: string;
      };

      log('Received token response:', data);

      const tokens: OAuthTokens = {
        access_token: data.access_token,
        token_type: data.token_type,
        expires_in: data.expires_in,
        scope: data.scope,
        refresh_token: data.refresh_token,
      };

      log('Saving tokens...');
      await this.saveTokens(tokens);
      log('Tokens saved successfully');

      return tokens;
    } catch (error) {
      log('Token exchange failed:', error);
      throw error;
    }
  }

  /**
   * Refreshes expired tokens
   * @param tokens The current tokens
   * @returns The refreshed tokens
   */
  async refreshTokens(tokens: OAuthTokens): Promise<OAuthTokens> {
    try {
      if (!tokens.refresh_token) {
        throw new Error('No refresh token available');
      }

      const tokenUrl = new URL('https://public-api.wordpress.com/oauth2/token');

      const response = await fetch(tokenUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token,
          client_id: this.softwareId,
          client_secret: this.clientSecret,
        }).toString(),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(
          `Token refresh failed: ${response.statusText}${errorData ? ` - ${JSON.stringify(errorData)}` : ''}`
        );
      }

      const data = (await response.json()) as {
        access_token: string;
        token_type: string;
        expires_in?: number;
        scope?: string;
        refresh_token?: string;
      };

      const refreshedTokens: OAuthTokens = {
        access_token: data.access_token,
        token_type: data.token_type,
        expires_in: data.expires_in,
        scope: data.scope,
        refresh_token: data.refresh_token,
      };
      await this.saveTokens(refreshedTokens);
      return refreshedTokens;
    } catch (error) {
      log('Failed to refresh tokens:', error);
      throw error;
    }
  }

  /**
   * Saves the PKCE code verifier
   * @param codeVerifier The code verifier to save
   */
  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    try {
      await writeTextFile(this.serverUrlHash, 'code_verifier.txt', codeVerifier);
    } catch (error) {
      log('Failed to save code verifier:', error);
      throw error;
    }
  }

  /**
   * Gets the PKCE code verifier
   * @returns The code verifier
   */
  async codeVerifier(): Promise<string> {
    try {
      return await readTextFile(
        this.serverUrlHash,
        'code_verifier.txt',
        'No code verifier saved for session'
      );
    } catch (error) {
      log('Failed to read code verifier:', error);
      throw error;
    }
  }
}
