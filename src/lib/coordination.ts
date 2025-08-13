/**
 * Multi-instance coordination for WordPress OAuth
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { EventEmitter } from 'node:events';
import { AuthCoordinator, WPTokens, OAuthError, LockfileData } from './oauth-types.js';
import { getConfigDir, getValidTokens } from './persistent-auth-config.js';
import { PersistentWPOAuthClientProvider } from './persistent-oauth-client-provider.js';
import { logger } from './utils.js';
import { CONFIG } from './config.js';

/**
 * Lockfile management for coordinating between multiple instances
 */
class LockfileManager {
  private lockfilePath: string;
  private isOwner: boolean = false;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(serverUrlHash: string) {
    const authDir = getConfigDir();
    this.lockfilePath = path.join(authDir, `${serverUrlHash}_auth.lock`);
  }

  /**
   * Try to acquire the lock
   */
  tryAcquire(): boolean {
    try {
      // Check if lockfile already exists
      if (fs.existsSync(this.lockfilePath)) {
        const lockData = this.readLockfile();
        if (lockData && this.isLockValid(lockData)) {
          logger.debug(`Lock is held by PID ${lockData.pid}`, 'COORDINATION');
          return false; // Lock is held by another process
        }
        // Lock is stale, remove it
        this.release();
      }

      // Create new lockfile
      const lockData: LockfileData = {
        pid: process.pid,
        port: CONFIG.OAUTH_CALLBACK_PORT,
        timestamp: Date.now(),
        hostname: os.hostname(),
      };

      fs.writeFileSync(this.lockfilePath, JSON.stringify(lockData), { mode: 0o600 });
      this.isOwner = true;

      // Start monitoring the lock
      this.startMonitoring();

      logger.debug(`Acquired auth lock: ${this.lockfilePath}`, 'COORDINATION');
      return true;
    } catch (error) {
      logger.error('Error acquiring lock', 'COORDINATION', error);
      return false;
    }
  }

  /**
   * Release the lock
   */
  release(): void {
    try {
      if (this.checkInterval) {
        clearInterval(this.checkInterval);
        this.checkInterval = null;
      }

      if (this.isOwner && fs.existsSync(this.lockfilePath)) {
        fs.unlinkSync(this.lockfilePath);
        logger.debug(`Released auth lock: ${this.lockfilePath}`, 'COORDINATION');
      }

      this.isOwner = false;
    } catch (error) {
      logger.error('Error releasing lock', 'COORDINATION', error);
    }
  }

  /**
   * Check if we own the lock
   */
  isLockOwner(): boolean {
    return this.isOwner;
  }

  /**
   * Wait for lock to be released
   */
  async waitForRelease(timeout: number = CONFIG.LOCK_TIMEOUT): Promise<void> {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const checkLock = () => {
        if (!fs.existsSync(this.lockfilePath)) {
          logger.debug('Lock file no longer exists', 'COORDINATION');
          resolve();
          return;
        }

        const lockData = this.readLockfile();
        if (!lockData || !this.isLockValid(lockData)) {
          // Lock is stale, clean it up
          logger.debug('Lock is stale, cleaning up', 'COORDINATION');
          this.release();
          resolve();
          return;
        }

        if (Date.now() - startTime > timeout) {
          reject(new OAuthError('Timeout waiting for auth lock', 'LOCK_TIMEOUT'));
          return;
        }

        // Check again in 1 second
        setTimeout(checkLock, 1000);
      };

      logger.info('Waiting for other instance to complete authentication...', 'COORDINATION');
      checkLock();
    });
  }

  /**
   * Read lockfile data
   */
  private readLockfile(): LockfileData | null {
    try {
      const data = fs.readFileSync(this.lockfilePath, 'utf8');
      return JSON.parse(data) as LockfileData;
    } catch {
      return null;
    }
  }

  /**
   * Check if lock is still valid (process is running)
   */
  private isLockValid(lockData: LockfileData): boolean {
    try {
      // Check if the process is still running
      process.kill(lockData.pid, 0);

      // Check if lock is not too old (safety measure)
      const age = Date.now() - lockData.timestamp;
      const maxAge = 600000; // 10 minutes max age

      if (age > maxAge) {
        logger.debug(
          `Lock is too old (${Math.round(age / 1000)}s), considering invalid`,
          'COORDINATION'
        );
        return false;
      }

      return true;
    } catch {
      // Process doesn't exist or we can't signal it
      logger.debug(`Process ${lockData.pid} is not running`, 'COORDINATION');
      return false;
    }
  }

  /**
   * Monitor lock validity
   */
  private startMonitoring(): void {
    this.checkInterval = setInterval(() => {
      if (this.isOwner && !fs.existsSync(this.lockfilePath)) {
        logger.warn('Lock file was removed externally', 'COORDINATION');
        this.isOwner = false;
        if (this.checkInterval) {
          clearInterval(this.checkInterval);
          this.checkInterval = null;
        }
      }
    }, 5000); // Check every 5 seconds
  }
}

/**
 * WordPress OAuth authentication coordinator
 */
export class WPAuthCoordinator implements AuthCoordinator {
  private serverUrlHash: string;
  private serverUrl: string;
  private callbackPort: number;
  private events: EventEmitter;
  private lockManager: LockfileManager;
  private oauthProvider: PersistentWPOAuthClientProvider | null = null;
  private isStarted: boolean = false;

  constructor(
    serverUrlHash: string,
    serverUrl: string,
    callbackPort: number,
    events: EventEmitter
  ) {
    this.serverUrlHash = serverUrlHash;
    this.serverUrl = serverUrl;
    this.callbackPort = callbackPort;
    this.events = events;
    this.lockManager = new LockfileManager(serverUrlHash);
  }

  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    logger.debug('Starting WordPress auth coordinator', 'COORDINATION');
    this.isStarted = true;

    // Setup cleanup on process exit
    process.on('exit', () => this.cleanup());
    process.on('SIGINT', () => this.cleanup());
    process.on('SIGTERM', () => this.cleanup());
    process.on('uncaughtException', () => this.cleanup());
    process.on('unhandledRejection', () => this.cleanup());
  }

  async stop(): Promise<void> {
    logger.debug('Stopping WordPress auth coordinator', 'COORDINATION');
    this.cleanup();
    this.isStarted = false;
  }

  async waitForAuth(): Promise<WPTokens> {
    if (!this.isStarted) {
      throw new OAuthError('Auth coordinator not started');
    }

    // First, check if we already have valid tokens
    const existingTokens = await getValidTokens(this.serverUrlHash);
    if (existingTokens) {
      logger.debug('Found existing valid tokens', 'COORDINATION');
      return existingTokens;
    }

    // Try to acquire the auth lock
    if (this.lockManager.tryAcquire()) {
      // We got the lock, perform authentication
      return await this.performAuthentication();
    } else {
      // Another instance is handling auth, wait for it
      return await this.waitForOtherInstanceAuth();
    }
  }

  private async performAuthentication(): Promise<WPTokens> {
    try {
      logger.info('Performing OAuth authentication as lock owner', 'COORDINATION');

      if (!this.oauthProvider) {
        this.oauthProvider = new PersistentWPOAuthClientProvider({
          serverUrl: this.serverUrl,
          callbackPort: this.callbackPort,
          host: CONFIG.OAUTH_HOST,
          clientId: CONFIG.WP_OAUTH_CLIENT_ID,
        });
      }

      await this.oauthProvider.authorize();

      const tokens = await this.oauthProvider.tokens();
      if (!tokens) {
        throw new OAuthError('Authentication completed but no tokens available');
      }

      logger.info('Authentication successful, tokens obtained', 'COORDINATION');
      return tokens;
    } finally {
      // Always release the lock when done
      this.lockManager.release();
    }
  }

  private async waitForOtherInstanceAuth(): Promise<WPTokens> {
    logger.info('Waiting for another instance to complete authentication', 'COORDINATION');

    try {
      // Wait for the lock to be released
      await this.lockManager.waitForRelease();

      // Check if tokens are now available
      const tokens = await getValidTokens(this.serverUrlHash);
      if (tokens) {
        logger.info('Tokens are now available from other instance', 'COORDINATION');
        return tokens;
      }

      // No tokens available, try to auth ourselves
      logger.debug(
        'No tokens found after waiting, trying to authenticate ourselves',
        'COORDINATION'
      );
      return await this.waitForAuth();
    } catch (error) {
      logger.error('Error waiting for other instance auth', 'COORDINATION', error);
      throw error;
    }
  }

  private cleanup(): void {
    this.lockManager.release();
  }
}

/**
 * Create a WordPress auth coordinator
 */
export function createWPAuthCoordinator(
  serverUrlHash: string,
  serverUrl: string,
  callbackPort: number,
  events: EventEmitter
): AuthCoordinator {
  return new WPAuthCoordinator(serverUrlHash, serverUrl, callbackPort, events);
}

/**
 * Lazy authentication coordinator that initializes only when needed
 */
export class LazyWPAuthCoordinator implements AuthCoordinator {
  private coordinator: WPAuthCoordinator | null = null;
  private serverUrlHash: string;
  private serverUrl: string;
  private callbackPort: number;
  private events: EventEmitter;

  constructor(
    serverUrlHash: string,
    serverUrl: string,
    callbackPort: number,
    events: EventEmitter
  ) {
    this.serverUrlHash = serverUrlHash;
    this.serverUrl = serverUrl;
    this.callbackPort = callbackPort;
    this.events = events;
  }

  async start(): Promise<void> {
    // Lazy initialization - start only when actually needed
  }

  async stop(): Promise<void> {
    if (this.coordinator) {
      await this.coordinator.stop();
      this.coordinator = null;
    }
  }

  async waitForAuth(): Promise<WPTokens> {
    // First check if we already have valid tokens
    const existingTokens = await getValidTokens(this.serverUrlHash);
    if (existingTokens) {
      return existingTokens;
    }

    // Initialize coordinator if needed
    if (!this.coordinator) {
      this.coordinator = new WPAuthCoordinator(
        this.serverUrlHash,
        this.serverUrl,
        this.callbackPort,
        this.events
      );
      await this.coordinator.start();
    }

    return await this.coordinator.waitForAuth();
  }
}

/**
 * Create a lazy WordPress auth coordinator
 */
export function createLazyWPAuthCoordinator(
  serverUrlHash: string,
  serverUrl: string,
  callbackPort: number,
  events: EventEmitter
): AuthCoordinator {
  return new LazyWPAuthCoordinator(serverUrlHash, serverUrl, callbackPort, events);
}
