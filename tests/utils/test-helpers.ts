/**
 * Test helper utilities for HTTP mocking and file system operations
 */

import nock from 'nock';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { createMockToken, createMockWordPressResponse, createMockErrorResponse } from './mock-factories.js';

/**
 * Sets up HTTP mocks for WordPress API
 */
export class WordPressMockServer {
  public scope: nock.Scope;

  constructor(baseUrl: string = 'https://api.example.com') {
    this.scope = nock(baseUrl);
  }

  /**
   * Mock successful OAuth token exchange
   */
  mockTokenExchange(code: string, clientId: string, clientSecret: string) {
    return this.scope
      .post('/oauth2/token')
      .query(true)
      .reply((uri, requestBody: any) => {
        const body = new URLSearchParams(requestBody);
        if (
          body.get('grant_type') === 'authorization_code' &&
          body.get('code') === code &&
          body.get('client_id') === clientId &&
          body.get('client_secret') === clientSecret
        ) {
          return [200, createMockToken()];
        }
        return [400, { error: 'invalid_grant', error_description: 'Invalid authorization code' }];
      });
  }

  /**
   * Mock token refresh
   */
  mockTokenRefresh(refreshToken: string, clientId: string, clientSecret: string) {
    return this.scope
      .post('/oauth2/token')
      .query(true)
      .reply((uri, requestBody: any) => {
        const body = new URLSearchParams(requestBody);
        if (
          body.get('grant_type') === 'refresh_token' &&
          body.get('refresh_token') === refreshToken &&
          body.get('client_id') === clientId &&
          body.get('client_secret') === clientSecret
        ) {
          return [200, createMockToken({ refresh_token: refreshToken })];
        }
        return [400, { error: 'invalid_grant', error_description: 'Invalid refresh token' }];
      });
  }

  /**
   * Mock user info endpoint
   */
  mockUserInfo(accessToken: string, userInfo: any = {}) {
    return this.scope
      .get('/rest/v1.1/me')
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, {
        ID: 987654321,
        login: 'testuser',
        email: 'test@example.com',
        display_name: 'Test User',
        ...userInfo,
      });
  }

  /**
   * Mock site info endpoint
   */
  mockSiteInfo(siteId: string, accessToken: string, siteInfo: any = {}) {
    return this.scope
      .get(`/rest/v1.1/sites/${siteId}`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .reply(200, {
        ID: parseInt(siteId),
        name: 'Test WordPress Site',
        URL: `https://test-site-${siteId}.com`,
        ...siteInfo,
      });
  }

  /**
   * Mock posts endpoint
   */
  mockPosts(siteId: string, accessToken: string, posts: any[] = []) {
    return this.scope
      .get(`/rest/v1.1/sites/${siteId}/posts`)
      .matchHeader('authorization', `Bearer ${accessToken}`)
      .query(true)
      .reply(200, {
        posts,
        found: posts.length,
        meta: {
          links: {
            self: `https://api.example.com/rest/v1.1/sites/${siteId}/posts`,
          },
        },
      });
  }

  /**
   * Mock API error responses
   */
  mockError(path: string, status: number, error: any) {
    return this.scope
      .get(path)
      .reply(status, error);
  }

  /**
   * Clean up all mocks
   */
  cleanup() {
    nock.cleanAll();
  }
}

/**
 * Creates a temporary directory for testing
 */
export async function createTempDir(prefix: string = 'mcp-wp-test-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/**
 * Creates a temporary file with content
 */
export async function createTempFile(
  dir: string,
  filename: string,
  content: string
): Promise<string> {
  const filepath = join(dir, filename);
  await writeFile(filepath, content, 'utf8');
  return filepath;
}

/**
 * Reads a temporary file
 */
export async function readTempFile(filepath: string): Promise<string> {
  return readFile(filepath, 'utf8');
}

/**
 * Cleans up temporary directory
 */
export async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors in tests
  }
}

/**
 * Mock environment variables for a test
 */
export function mockEnv(vars: Record<string, string>): () => void {
  const originalEnv = { ...process.env };
  
  // Set test environment variables
  Object.assign(process.env, vars);
  
  // Return cleanup function
  return () => {
    process.env = originalEnv;
  };
}

/**
 * Wait for a specified amount of time
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate a random test string
 */
export function randomString(length: number = 10): string {
  return Math.random().toString(36).substring(2, 2 + length);
}

/**
 * Generate a test port number
 */
export function randomPort(): number {
  return 3000 + Math.floor(Math.random() * 1000);
}

/**
 * Mock console methods to capture output
 */
export class ConsoleCapture {
  private originalConsole: any;
  public logs: string[] = [];
  public errors: string[] = [];
  public warns: string[] = [];

  start() {
    this.originalConsole = { ...console };
    console.log = (...args) => this.logs.push(args.join(' '));
    console.error = (...args) => this.errors.push(args.join(' '));
    console.warn = (...args) => this.warns.push(args.join(' '));
  }

  stop() {
    Object.assign(console, this.originalConsole);
  }

  clear() {
    this.logs = [];
    this.errors = [];
    this.warns = [];
  }
}

/**
 * Asserts that a promise throws an error with a specific message
 */
export async function expectToThrow(
  promise: Promise<any>,
  expectedMessage?: string | RegExp
): Promise<Error> {
  try {
    await promise;
    throw new Error('Expected promise to throw, but it resolved');
  } catch (error) {
    if (expectedMessage) {
      if (typeof expectedMessage === 'string') {
        expect((error as Error).message).toContain(expectedMessage);
      } else {
        expect((error as Error).message).toMatch(expectedMessage);
      }
    }
    return error as Error;
  }
}

/**
 * Create a mock timer for testing time-dependent code
 */
export class MockTimer {
  private originalNow: () => number;
  private currentTime: number;

  constructor(startTime: number = Date.now()) {
    this.originalNow = Date.now;
    this.currentTime = startTime;
    Date.now = () => this.currentTime;
  }

  advance(ms: number) {
    this.currentTime += ms;
  }

  set(time: number) {
    this.currentTime = time;
  }

  restore() {
    Date.now = this.originalNow;
  }
}
