/**
 * Unit tests for utils module
 */

import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import tmp from 'tmp';
import { mockEnv } from '../utils/test-helpers.js';

describe('Utils Module', () => {
  let tempDir: string;
  let restoreEnv: () => void;
  let originalStderr: any;

  beforeEach(() => {
    jest.resetModules();
    tempDir = tmp.dirSync({ unsafeCleanup: true }).name;

    // Mock stderr to capture log output
    originalStderr = process.stderr.write;
    process.stderr.write = jest.fn(() => true);
  });

  afterEach(() => {
    if (restoreEnv) {
      restoreEnv();
    }
    // Restore stderr
    process.stderr.write = originalStderr;

    // Cleanup temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Log function', () => {
    // log() only writes to stderr when LOG_TO_STDERR=true.
    // These tests set that env var before importing the module.

    it('should log messages to stderr with correct format when LOG_TO_STDERR is true', async () => {
      restoreEnv = mockEnv({
        LOG_TO_STDERR: 'true',
      });

      const { log, LogLevel } = await import('../../src/lib/utils.js');

      log('Test message', LogLevel.INFO, 'TEST');

      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[INFO\] \[TEST\] Test message\n$/)
      );
    });

    it('should not write to stderr when LOG_TO_STDERR is not set', async () => {
      restoreEnv = mockEnv({});

      const { log, LogLevel } = await import('../../src/lib/utils.js');

      log('Test message', LogLevel.INFO, 'TEST');

      expect(process.stderr.write).not.toHaveBeenCalled();
    });

    it('should log with default level INFO and category GENERAL', async () => {
      restoreEnv = mockEnv({
        LOG_TO_STDERR: 'true',
      });

      const { log } = await import('../../src/lib/utils.js');

      log('Default test');

      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringMatching(/\[INFO\] \[GENERAL\] Default test\n$/)
      );
    });

    it('should include additional arguments in log output', async () => {
      restoreEnv = mockEnv({
        LOG_TO_STDERR: 'true',
        LOG_LEVEL: '3', // DEBUG level to see the message
      });

      const { log, LogLevel } = await import('../../src/lib/utils.js');

      const testObj = { key: 'value', number: 42 };
      log('Test with args', LogLevel.DEBUG, 'TEST', testObj, 'string arg');

      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringMatching(/Test with args\n.*"key":\s*"value".*string arg/s)
      );
    });

    it('should include Error message and stack in log output', async () => {
      restoreEnv = mockEnv({
        LOG_TO_STDERR: 'true',
        LOG_LEVEL: '3', // DEBUG level to see the message
      });

      const { log, LogLevel } = await import('../../src/lib/utils.js');

      log('Init failed', LogLevel.ERROR, 'INIT', new Error('connection refused'));

      // Plain JSON.stringify(new Error()) returns "{}" — the message must survive.
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringMatching(/"message":\s*"connection refused"/)
      );
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringMatching(/"name":\s*"Error"/)
      );
      expect(process.stderr.write).toHaveBeenCalledWith(expect.stringMatching(/"stack":/));
    });

    it('should include custom error properties like statusCode and endpoint', async () => {
      restoreEnv = mockEnv({
        LOG_TO_STDERR: 'true',
        LOG_LEVEL: '3',
      });

      const { log, LogLevel } = await import('../../src/lib/utils.js');

      // Simulate an APIError shape: Error subclass with extra own properties.
      const apiError = new Error('Request failed with status 404');
      apiError.name = 'APIError';
      (apiError as any).statusCode = 404;
      (apiError as any).endpoint = 'https://example.com/?rest_route=/wp/v2/wpmcp';

      log('WordPress request failed', LogLevel.ERROR, 'API', apiError);

      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringMatching(/"message":\s*"Request failed with status 404"/)
      );
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringMatching(/"statusCode":\s*404/)
      );
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringMatching(/"endpoint":\s*"https:\/\/example\.com\/\?rest_route=\/wp\/v2\/wpmcp"/)
      );
    });

    it('should respect log level filtering', async () => {
      restoreEnv = mockEnv({
        LOG_TO_STDERR: 'true',
        LOG_LEVEL: '1', // WARN level
      });

      const { log, LogLevel } = await import('../../src/lib/utils.js');

      // ERROR and WARN should be logged
      log('Error message', LogLevel.ERROR, 'TEST');
      log('Warn message', LogLevel.WARN, 'TEST');

      // INFO and DEBUG should be filtered out
      log('Info message', LogLevel.INFO, 'TEST');
      log('Debug message', LogLevel.DEBUG, 'TEST');

      expect(process.stderr.write).toHaveBeenCalledTimes(2);
    });

    it('should use DEBUG level in development environment', async () => {
      restoreEnv = mockEnv({
        LOG_TO_STDERR: 'true',
        NODE_ENV: 'development',
      });

      const { log, LogLevel } = await import('../../src/lib/utils.js');

      // In development, DEBUG messages should be logged
      log('Debug message', LogLevel.DEBUG, 'TEST');

      expect(process.stderr.write).toHaveBeenCalled();
    });

    it('should use INFO level by default in non-development', async () => {
      restoreEnv = mockEnv({
        LOG_TO_STDERR: 'true',
        NODE_ENV: 'production',
      });

      const { log, LogLevel } = await import('../../src/lib/utils.js');

      // DEBUG should be filtered out
      log('Debug message', LogLevel.DEBUG, 'TEST');

      // INFO should be logged
      log('Info message', LogLevel.INFO, 'TEST');

      expect(process.stderr.write).toHaveBeenCalledTimes(1);
    });

    it('should log to file when LOG_FILE is configured', async () => {
      const logFile = path.join(tempDir, 'test.log');

      restoreEnv = mockEnv({
        LOG_FILE: logFile,
      });

      const { log, LogLevel } = await import('../../src/lib/utils.js');

      log('File log test', LogLevel.INFO, 'TEST');

      expect(fs.existsSync(logFile)).toBe(true);
      const logContent = fs.readFileSync(logFile, 'utf-8');
      expect(logContent).toContain('File log test');
    });

    it('should create log directory if it does not exist', async () => {
      const logDir = path.join(tempDir, 'logs');
      const logFile = path.join(logDir, 'test.log');

      restoreEnv = mockEnv({
        LOG_FILE: logFile,
      });

      // Import should create the directory
      await import('../../src/lib/utils.js');

      expect(fs.existsSync(logDir)).toBe(true);
    });
  });

  describe('Logger convenience functions', () => {
    // Consolidated: each convenience function routes to log() with correct level and category.
    // We verify them using LOG_TO_STDERR + LOG_LEVEL=3 to capture all messages.

    it.each([
      ['error', 'ERROR', 'CUSTOM', 'Error message'],
      ['warn', 'WARN', 'WARN', 'Warning message'],
      ['info', 'INFO', 'INFO', 'Info message'],
    ] as const)('logger.%s logs with [%s] level', async (method, level, category, message) => {
      restoreEnv = mockEnv({
        LOG_TO_STDERR: 'true',
        LOG_LEVEL: '3',
      });

      const { logger } = await import('../../src/lib/utils.js');

      if (method === 'error') {
        logger.error(message, category);
      } else if (method === 'warn') {
        logger.warn(message);
      } else {
        logger.info(message);
      }

      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`\\[${level}\\] \\[${category}\\] ${message}\\n$`))
      );
    });

    it('logger.debug logs at DEBUG level', async () => {
      restoreEnv = mockEnv({
        LOG_TO_STDERR: 'true',
        LOG_LEVEL: '3', // DEBUG level
      });

      const { logger } = await import('../../src/lib/utils.js');

      logger.debug('Debug message');

      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringMatching(/\[DEBUG\] \[DEBUG\] Debug message\n$/)
      );
    });

    describe('Specialized category loggers', () => {
      // Consolidated: auth, oauth, api, config all follow the same pattern.
      // One parameterized test covers them all.

      it.each([
        ['auth', 'AUTH'],
        ['oauth', 'OAUTH'],
        ['api', 'API'],
        ['config', 'CONFIG'],
      ] as const)('logger.%s logs with [INFO] [%s] category', async (method, category) => {
        restoreEnv = mockEnv({
          LOG_TO_STDERR: 'true',
          LOG_LEVEL: '3',
        });

        const { logger } = await import('../../src/lib/utils.js');

        (logger as any)[method](`${category} test message`);

        expect(process.stderr.write).toHaveBeenCalledWith(
          expect.stringMatching(new RegExp(`\\[INFO\\] \\[${category}\\] ${category} test message\\n$`))
        );
      });

      it('should allow custom log levels in specialized loggers', async () => {
        restoreEnv = mockEnv({
          LOG_TO_STDERR: 'true',
          LOG_LEVEL: '3',
        });

        const { logger, LogLevel } = await import('../../src/lib/utils.js');

        logger.auth('Error auth message', LogLevel.ERROR);

        expect(process.stderr.write).toHaveBeenCalledWith(
          expect.stringMatching(/\[ERROR\] \[AUTH\] Error auth message\n$/)
        );
      });
    });
  });

  describe('Signal handlers', () => {
    it('should set up signal handlers for cleanup', async () => {
      const { setupSignalHandlers } = await import('../../src/lib/utils.js');

      const mockCleanup = jest.fn() as jest.MockedFunction<() => Promise<void>>;
      mockCleanup.mockResolvedValue(void 0);
      const originalOn = process.on;
      const mockOn = jest.fn();
      process.on = mockOn as any;

      setupSignalHandlers(mockCleanup);

      expect(mockOn).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('SIGHUP', expect.any(Function));

      // Restore process.on
      process.on = originalOn;
    });

    it('should call cleanup function when signal is received', async () => {
      const { setupSignalHandlers } = await import('../../src/lib/utils.js');

      const mockCleanup = jest.fn() as jest.MockedFunction<() => Promise<void>>;
      mockCleanup.mockResolvedValue(void 0);
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit');
      });

      let signalHandler: Function | undefined;
      const mockOn = jest.fn().mockImplementation((signal: any, handler: any) => {
        if (signal === 'SIGINT') {
          signalHandler = handler;
        }
      });
      const originalOn = process.on;
      process.on = mockOn as any;

      setupSignalHandlers(mockCleanup);

      // Simulate SIGINT signal - should throw because of mocked exit
      if (signalHandler) {
        await expect(signalHandler()).rejects.toThrow('process.exit');
      }

      expect(mockCleanup).toHaveBeenCalled();

      // Restore
      process.on = originalOn;
      mockExit.mockRestore();
    });
  });

  describe('Server URL hash', () => {
    it('should generate consistent 8-char hex hash from SHA-256', async () => {
      const { getServerUrlHash } = await import('../../src/lib/utils.js');

      const serverUrl = 'https://example.com';
      const hash1 = getServerUrlHash(serverUrl);
      const hash2 = getServerUrlHash(serverUrl);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(8);
      expect(hash1).toMatch(/^[a-f0-9]+$/);
    });

    it('should generate different hashes for different URLs', async () => {
      const { getServerUrlHash } = await import('../../src/lib/utils.js');

      const hash1 = getServerUrlHash('https://example.com');
      const hash2 = getServerUrlHash('https://different.com');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Coordinator server', () => {
    it('should create HTTP server on specified port', async () => {
      const { createCoordinatorServer } = await import('../../src/lib/utils.js');

      const { server, port } = createCoordinatorServer(0); // Use port 0 for random assignment

      expect(server).toBeDefined();
      expect(port).toBe(0);

      // Cleanup
      server.close();
    });

    it('should log when server starts listening', async () => {
      restoreEnv = mockEnv({
        LOG_TO_STDERR: 'true',
      });

      const { createCoordinatorServer } = await import('../../src/lib/utils.js');

      const { server } = createCoordinatorServer(0);

      // Wait for the server to start
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringMatching(/Coordinator server listening on port/)
      );

      // Cleanup
      server.close();
    });
  });

  describe('MCP Proxy', () => {
    it('should forward request to WordPress and return JSON-RPC response', async () => {
      const { mcpProxy } = await import('../../src/lib/utils.js');

      const mockTransport = {
        onmessage: null as any,
        send: jest.fn(),
      };

      const mockWpRequest = jest.fn() as jest.MockedFunction<(params: any) => Promise<any>>;
      mockWpRequest.mockResolvedValue({ status: 'success' });

      mcpProxy({
        transportToClient: mockTransport as any,
        wpRequest: mockWpRequest as any,
      });

      expect(mockTransport.onmessage).toBeDefined();

      // Simulate incoming message
      const testMessage = {
        id: 'test-id',
        method: 'test-method',
        params: { test: 'param' },
      };

      await mockTransport.onmessage(testMessage);

      expect(mockWpRequest).toHaveBeenCalledWith({
        method: 'test-method',
        test: 'param',
      });

      expect(mockTransport.send).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        id: 'test-id',
        result: { status: 'success' },
      });
    });

    it('should send JSON-RPC error when request fails with Error', async () => {
      const { mcpProxy } = await import('../../src/lib/utils.js');

      const mockTransport = {
        onmessage: null as any,
        send: jest.fn(),
      };

      const mockWpRequest = jest.fn() as jest.MockedFunction<(params: any) => Promise<any>>;
      mockWpRequest.mockRejectedValue(new Error('Request failed'));

      mcpProxy({
        transportToClient: mockTransport as any,
        wpRequest: mockWpRequest as any,
      });

      await mockTransport.onmessage({
        id: 'test-id',
        method: 'test-method',
        params: {},
      });

      expect(mockTransport.send).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        id: 'test-id',
        error: {
          code: -32000,
          message: 'Request failed',
        },
      });
    });

    it('should coerce non-Error exceptions to string in error response', async () => {
      const { mcpProxy } = await import('../../src/lib/utils.js');

      const mockTransport = {
        onmessage: null as any,
        send: jest.fn(),
      };

      const mockWpRequest = jest.fn() as jest.MockedFunction<(params: any) => Promise<any>>;
      mockWpRequest.mockRejectedValue('String error');

      mcpProxy({
        transportToClient: mockTransport as any,
        wpRequest: mockWpRequest as any,
      });

      await mockTransport.onmessage({
        id: 'test-id',
        method: 'test-method',
        params: {},
      });

      expect(mockTransport.send).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        id: 'test-id',
        error: {
          code: -32000,
          message: 'String error',
        },
      });
    });

    it('should ignore messages without method', async () => {
      const { mcpProxy } = await import('../../src/lib/utils.js');

      const mockTransport = {
        onmessage: null as any,
        send: jest.fn(),
      };

      const mockWpRequest = jest.fn();

      mcpProxy({
        transportToClient: mockTransport as any,
        wpRequest: mockWpRequest as any,
      });

      // Simulate incoming message without method
      await mockTransport.onmessage({
        id: 'test-id',
        params: {},
      });

      expect(mockWpRequest).not.toHaveBeenCalled();
      expect(mockTransport.send).not.toHaveBeenCalled();
    });
  });
});
