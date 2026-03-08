/**
 * Unit tests for persistent-auth-config module
 */

import { jest } from '@jest/globals';
import tmp from 'tmp';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { mockEnv } from '../utils/test-helpers.js';

describe('Persistent Auth Config Module', () => {
  let tempDir: string;
  let restoreEnv: () => void;

  beforeEach(() => {
    // Create a temporary directory for each test
    tempDir = tmp.dirSync({ unsafeCleanup: true }).name;
    
    // Mock the config directory to use our temp directory
    restoreEnv = mockEnv({
      WP_MCP_CONFIG_DIR: tempDir,
    });

    jest.resetModules();
  });

  afterEach(() => {
    if (restoreEnv) {
      restoreEnv();
    }
    // Cleanup temp directory
    if (fsSync.existsSync(tempDir)) {
      fsSync.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Configuration directory management', () => {
    it('should create config directory with proper structure', async () => {
      const { getConfigDir, ensureConfigDir } = await import('../../src/lib/persistent-auth-config.js');
      
      await ensureConfigDir();
      const configDir = getConfigDir();
      
      expect(configDir).toMatch(/wordpress-remote-\d+\.\d+\.\d+/);
      expect(fsSync.existsSync(configDir)).toBe(true);
      
      // Check permissions (on Unix systems)
      if (process.platform !== 'win32') {
        const stats = await fs.stat(configDir);
        expect(stats.mode & 0o777).toBe(0o700); // rwx for owner only
      }
    });

    it('should use default config directory when no env var set', async () => {
      restoreEnv = mockEnv({});

      const { getConfigDir } = await import('../../src/lib/persistent-auth-config.js');
      const configDir = getConfigDir();
      
      // In test environment, we may use different directory paths
      expect(configDir).toMatch(/wordpress-remote-\d+\.\d+\.\d+/);
    });

    it('should handle config directory creation errors gracefully', async () => {
      // Create a file where the versioned directory should be to cause an error.
      // getConfigDir() returns path.join(tempDir, 'wordpress-remote-<VERSION>'),
      // so we must use the actual version string to trigger the conflict.
      const { getConfigDir, ensureConfigDir } = await import('../../src/lib/persistent-auth-config.js');
      const conflictPath = getConfigDir();
      // Ensure parent exists, then place a regular file where mkdir expects a directory
      await fs.mkdir(path.dirname(conflictPath), { recursive: true });
      await fs.writeFile(conflictPath, 'conflict');

      await expect(ensureConfigDir()).rejects.toThrow();
    });
  });

  describe('File path generation', () => {
    it('should generate correct file paths', async () => {
      const { getConfigFilePath, getConfigDir } = await import('../../src/lib/persistent-auth-config.js');
      
      const serverHash = 'abc123';
      const filename = 'tokens.json';
      const filePath = getConfigFilePath(serverHash, filename);
      
      expect(filePath).toBe(path.join(getConfigDir(), `${serverHash}_${filename}`));
    });
  });

  describe('Server URL hash generation', () => {
    it('should generate consistent MD5 hash for server URL', async () => {
      const { generateServerUrlHash } = await import('../../src/lib/persistent-auth-config.js');
      
      const serverUrl = 'https://example.com';
      const hash1 = generateServerUrlHash(serverUrl);
      const hash2 = generateServerUrlHash(serverUrl);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(32); // MD5 hex string length
      expect(hash1).toMatch(/^[a-f0-9]+$/); // Valid hex string
    });

    it('should generate different hashes for different URLs', async () => {
      const { generateServerUrlHash } = await import('../../src/lib/persistent-auth-config.js');
      
      const hash1 = generateServerUrlHash('https://example.com');
      const hash2 = generateServerUrlHash('https://different.com');
      
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('JSON file operations', () => {
    const serverHash = 'test123';
    const testData = { test: 'data', number: 42 };

    it('should write and read JSON files correctly', async () => {
      const { writeJsonFile, readJsonFile } = await import('../../src/lib/persistent-auth-config.js');
      
      await writeJsonFile(serverHash, 'test.json', testData);
      const readData = await readJsonFile(serverHash, 'test.json');
      
      expect(readData).toEqual(testData);
    });

    it('should set secure file permissions on JSON files', async () => {
      const { writeJsonFile, getConfigFilePath } = await import('../../src/lib/persistent-auth-config.js');
      
      await writeJsonFile(serverHash, 'test.json', testData);
      
      // Check file permissions (on Unix systems)
      if (process.platform !== 'win32') {
        const filePath = getConfigFilePath(serverHash, 'test.json');
        const stats = await fs.stat(filePath);
        expect(stats.mode & 0o777).toBe(0o600); // rw for owner only
      }
    });

    it('should return undefined for non-existent JSON files', async () => {
      const { readJsonFile } = await import('../../src/lib/persistent-auth-config.js');
      
      const result = await readJsonFile(serverHash, 'nonexistent.json');
      expect(result).toBeUndefined();
    });

    it('should handle JSON file read errors gracefully', async () => {
      const { readJsonFile, getConfigFilePath, ensureConfigDir } = await import('../../src/lib/persistent-auth-config.js');
      
      await ensureConfigDir();
      // Create invalid JSON file
      const filePath = getConfigFilePath(serverHash, 'invalid.json');
      await fs.writeFile(filePath, 'invalid json content');
      
      const result = await readJsonFile(serverHash, 'invalid.json');
      expect(result).toBeUndefined();
    });

    it('should handle JSON file write errors', async () => {
      const { writeJsonFile } = await import('../../src/lib/persistent-auth-config.js');
      
      // This test is difficult to reproduce reliably in different environments
      // Instead, let's test that writeJsonFile throws when provided invalid data
      
      // Create circular reference to cause JSON.stringify to fail
      const circularData: any = {};
      circularData.self = circularData;

      await expect(writeJsonFile(serverHash, 'test.json', circularData)).rejects.toThrow();
    });
  });

  describe('Text file operations', () => {
    const serverHash = 'test123';
    const testText = 'test content\nwith newlines';

    it('should write and read text files correctly', async () => {
      const { writeTextFile, readTextFile } = await import('../../src/lib/persistent-auth-config.js');
      
      await writeTextFile(serverHash, 'test.txt', testText);
      const readText = await readTextFile(serverHash, 'test.txt');
      
      expect(readText).toBe(testText);
    });

    it('should set secure file permissions on text files', async () => {
      const { writeTextFile, getConfigFilePath } = await import('../../src/lib/persistent-auth-config.js');
      
      await writeTextFile(serverHash, 'test.txt', testText);
      
      // Check file permissions (on Unix systems)
      if (process.platform !== 'win32') {
        const filePath = getConfigFilePath(serverHash, 'test.txt');
        const stats = await fs.stat(filePath);
        expect(stats.mode & 0o777).toBe(0o600); // rw for owner only
      }
    });

    it('should throw error for non-existent text files', async () => {
      const { readTextFile } = await import('../../src/lib/persistent-auth-config.js');
      
      await expect(readTextFile(serverHash, 'nonexistent.txt')).rejects.toThrow();
    });

    it('should use custom error message for text file read errors', async () => {
      const { readTextFile } = await import('../../src/lib/persistent-auth-config.js');
      
      const customError = 'Custom error message';
      await expect(readTextFile(serverHash, 'nonexistent.txt', customError)).rejects.toThrow(customError);
    });
  });

  describe('File deletion', () => {
    const serverHash = 'test123';

    it('should delete existing files successfully', async () => {
      const { writeJsonFile, deleteConfigFile, getConfigFilePath } = await import('../../src/lib/persistent-auth-config.js');
      
      await writeJsonFile(serverHash, 'test.json', { test: 'data' });
      const filePath = getConfigFilePath(serverHash, 'test.json');
      
      expect(fsSync.existsSync(filePath)).toBe(true);
      
      await deleteConfigFile(serverHash, 'test.json');
      
      expect(fsSync.existsSync(filePath)).toBe(false);
    });

    it('should handle deletion of non-existent files gracefully', async () => {
      const { deleteConfigFile } = await import('../../src/lib/persistent-auth-config.js');
      
      // Should not throw error
      await expect(deleteConfigFile(serverHash, 'nonexistent.json')).resolves.toBeUndefined();
    });
  });

  describe('Token management', () => {
    const serverHash = 'test123';
    const testTokens = {
      access_token: 'access_token_123',
      refresh_token: 'refresh_token_456',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'read write',
      obtained_at: Date.now(),
    };

    it('should write and read tokens correctly', async () => {
      const { writeTokens, readTokens } = await import('../../src/lib/persistent-auth-config.js');
      
      await writeTokens(serverHash, testTokens);
      const readTokens_result = await readTokens(serverHash);
      
      expect(readTokens_result).toMatchObject({
        access_token: testTokens.access_token,
        refresh_token: testTokens.refresh_token,
        token_type: testTokens.token_type,
        expires_in: testTokens.expires_in,
        scope: testTokens.scope,
      });
      expect(readTokens_result?.obtained_at).toBeGreaterThan(0);
    });

    it('should return null for non-existent tokens', async () => {
      const { readTokens } = await import('../../src/lib/persistent-auth-config.js');
      
      const result = await readTokens('nonexistent');
      expect(result).toBeNull();
    });

    it('should delete tokens successfully', async () => {
      const { writeTokens, deleteTokens, readTokens } = await import('../../src/lib/persistent-auth-config.js');
      
      await writeTokens(serverHash, testTokens);
      expect(await readTokens(serverHash)).not.toBeNull();
      
      await deleteTokens(serverHash);
      expect(await readTokens(serverHash)).toBeNull();
    });

    it('should handle token read errors gracefully', async () => {
      const { readTokens, getConfigFilePath, ensureConfigDir } = await import('../../src/lib/persistent-auth-config.js');
      
      await ensureConfigDir();
      // Create invalid JSON file
      const filePath = getConfigFilePath(serverHash, 'tokens.json');
      await fs.writeFile(filePath, 'invalid json');
      
      const result = await readTokens(serverHash);
      expect(result).toBeNull();
    });
  });

  describe('Client info management', () => {
    const serverHash = 'test123';
    const testClientInfo = {
      client_id: 'test_client_id',
      client_secret: 'test_client_secret',
      registration_endpoint: 'https://example.com/oauth/register',
    };

    it('should write and read client info correctly', async () => {
      const { writeClientInfo, readClientInfo } = await import('../../src/lib/persistent-auth-config.js');
      
      await writeClientInfo(serverHash, testClientInfo);
      const readInfo = await readClientInfo(serverHash);
      
      expect(readInfo).toEqual(testClientInfo);
    });

    it('should return null for non-existent client info', async () => {
      const { readClientInfo } = await import('../../src/lib/persistent-auth-config.js');
      
      const result = await readClientInfo('nonexistent');
      expect(result).toBeNull();
    });

    it('should handle client info read errors gracefully', async () => {
      const { readClientInfo, getConfigFilePath, ensureConfigDir } = await import('../../src/lib/persistent-auth-config.js');
      
      await ensureConfigDir();
      // Create invalid JSON file
      const filePath = getConfigFilePath(serverHash, 'client_info.json');
      await fs.writeFile(filePath, 'invalid json');
      
      const result = await readClientInfo(serverHash);
      expect(result).toBeNull();
    });
  });

  describe('Token validation', () => {
    it('should validate tokens with access_token as valid', async () => {
      const { isTokenValid } = await import('../../src/lib/persistent-auth-config.js');
      
      const validTokens = {
        access_token: 'valid_token',
        token_type: 'Bearer',
        obtained_at: Date.now(),
        expires_in: 3600,
      };
      
      const result = isTokenValid(validTokens);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.expiresIn).toBeGreaterThan(0);
    });

    it('should invalidate tokens without access_token', async () => {
      const { isTokenValid } = await import('../../src/lib/persistent-auth-config.js');
      
      const invalidTokens = {
        token_type: 'Bearer',
        obtained_at: Date.now(),
        expires_in: 3600,
      } as any;
      
      const result = isTokenValid(invalidTokens);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('No access token');
    });

    it('should consider tokens valid when no expiration info is available', async () => {
      const { isTokenValid } = await import('../../src/lib/persistent-auth-config.js');
      
      const tokensWithoutExpiry = {
        access_token: 'valid_token',
        token_type: 'Bearer',
      } as any;
      
      const result = isTokenValid(tokensWithoutExpiry);
      expect(result.isValid).toBe(true);
    });

    it('should invalidate expired tokens', async () => {
      const { isTokenValid } = await import('../../src/lib/persistent-auth-config.js');
      
      const expiredTokens = {
        access_token: 'expired_token',
        token_type: 'Bearer',
        obtained_at: Date.now() - 7200000, // 2 hours ago
        expires_in: 3600, // 1 hour validity
      };
      
      const result = isTokenValid(expiredTokens);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Token expired');
      expect(result.expiresIn).toBe(0);
    });

    it('should use 60-second buffer for token expiration', async () => {
      const { isTokenValid } = await import('../../src/lib/persistent-auth-config.js');
      
      const almostExpiredTokens = {
        access_token: 'almost_expired_token',
        token_type: 'Bearer',
        obtained_at: Date.now() - 3570000, // 59.5 minutes ago
        expires_in: 3600, // 1 hour validity (30 seconds left)
      };
      
      const result = isTokenValid(almostExpiredTokens);
      expect(result.isValid).toBe(false); // Should be invalid due to 60-second buffer
    });
  });

  describe('Get valid tokens', () => {
    const serverHash = 'test123';

    it('should return valid tokens when they exist and are not expired', async () => {
      const { writeTokens, getValidTokens } = await import('../../src/lib/persistent-auth-config.js');
      
      const validTokens = {
        access_token: 'valid_token',
        token_type: 'Bearer',
        obtained_at: Date.now(),
        expires_in: 3600,
      };
      
      await writeTokens(serverHash, validTokens);
      const result = await getValidTokens(serverHash);
      
      expect(result).toMatchObject(validTokens);
    });

    it('should return null when no tokens exist', async () => {
      const { getValidTokens } = await import('../../src/lib/persistent-auth-config.js');
      
      const result = await getValidTokens('nonexistent');
      expect(result).toBeNull();
    });

    it('should return null for expired tokens', async () => {
      const { writeJsonFile, getValidTokens } = await import('../../src/lib/persistent-auth-config.js');
      
      // Create tokens that are clearly expired (more than the 60-second buffer)
      // Use writeJsonFile directly to avoid the timestamp override in writeTokens
      const expiredTokens = {
        access_token: 'expired_token',
        token_type: 'Bearer',
        obtained_at: Date.now() - 3720000, // Over 1 hour ago (3720 seconds = 62 minutes)
        expires_in: 3600, // 1 hour validity (so token expired 2+ minutes ago, well beyond the 60-second buffer)
        refresh_token: 'refresh_token',
        scope: 'read write',
      };
      
      await writeJsonFile(serverHash, 'tokens.json', expiredTokens);
      const result = await getValidTokens(serverHash);
      
      expect(result).toBeNull();
    });
  });

  describe('Lockfile management', () => {
    const serverHash = 'test123';
    const testLockData = {
      pid: 12345,
      port: 3000,
      timestamp: Date.now(),
      hostname: 'test-host',
    };

    it('should create and read lockfiles correctly', async () => {
      const { createLockfile, checkLockfile } = await import('../../src/lib/persistent-auth-config.js');
      
      await createLockfile(serverHash, testLockData.pid, testLockData.port);
      const lockData = await checkLockfile(serverHash);
      
      expect(lockData).toMatchObject({
        pid: testLockData.pid,
        port: testLockData.port,
      });
      expect(lockData?.timestamp).toBeGreaterThan(0);
      expect(lockData?.hostname).toBeTruthy();
    });

    it('should return null for non-existent lockfiles', async () => {
      const { checkLockfile } = await import('../../src/lib/persistent-auth-config.js');
      
      const result = await checkLockfile('nonexistent');
      expect(result).toBeNull();
    });

    it('should delete lockfiles successfully', async () => {
      const { createLockfile, deleteLockfile, checkLockfile } = await import('../../src/lib/persistent-auth-config.js');
      
      await createLockfile(serverHash, testLockData.pid, testLockData.port);
      expect(await checkLockfile(serverHash)).not.toBeNull();
      
      await deleteLockfile(serverHash);
      expect(await checkLockfile(serverHash)).toBeNull();
    });
  });

  describe('Cleanup expired tokens', () => {
    it('should clean up expired token files', async () => {
      const { writeTokens, writeJsonFile, cleanupExpiredTokens, readTokens } = await import('../../src/lib/persistent-auth-config.js');
      
      const serverHash1 = 'server1';
      const serverHash2 = 'server2';
      
      // Create one valid token using writeTokens (gets current timestamp)
      const validTokens = {
        access_token: 'valid_token',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'refresh_token',
        scope: 'read write',
        obtained_at: Date.now(), // Will be overridden by writeTokens but required for type
      };
      
      // Create one expired token using writeJsonFile (preserves our timestamp)
      const expiredTokens = {
        access_token: 'expired_token',
        token_type: 'Bearer',
        obtained_at: Date.now() - 3720000, // Over 1 hour ago (3720 seconds = 62 minutes)
        expires_in: 3600, // 1 hour validity (so token expired 2+ minutes ago, well beyond the 60-second buffer)
        refresh_token: 'refresh_token',
        scope: 'read write',
      };
      
      await writeTokens(serverHash1, validTokens);
      await writeJsonFile(serverHash2, 'tokens.json', expiredTokens);
      
      // Run cleanup
      await cleanupExpiredTokens();
      
      // Valid tokens should remain, expired should be deleted
      expect(await readTokens(serverHash1)).not.toBeNull();
      expect(await readTokens(serverHash2)).toBeNull();
    });

    it('should handle cleanup when config directory does not exist', async () => {
      // Remove config directory
      if (fsSync.existsSync(tempDir)) {
        fsSync.rmSync(tempDir, { recursive: true, force: true });
      }

      const { cleanupExpiredTokens } = await import('../../src/lib/persistent-auth-config.js');
      
      // Should not throw error
      await expect(cleanupExpiredTokens()).resolves.toBeUndefined();
    });

    it('should handle cleanup errors gracefully', async () => {
      const { ensureConfigDir, cleanupExpiredTokens, getConfigDir } = await import('../../src/lib/persistent-auth-config.js');
      
      await ensureConfigDir();
      
      // Create an invalid token file that will cause JSON parsing to fail
      const configDir = getConfigDir();
      await fs.writeFile(path.join(configDir, 'invalid_tokens.json'), 'invalid json');
      
      // Should not throw error
      await expect(cleanupExpiredTokens()).resolves.toBeUndefined();
    });
  });
});
