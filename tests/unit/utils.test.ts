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

  describe('LogLevel enum', () => {
    it('should have correct log level values', async () => {
      const { LogLevel } = await import('../../src/lib/utils.js');
      
      expect(LogLevel.ERROR).toBe(0);
      expect(LogLevel.WARN).toBe(1);
      expect(LogLevel.INFO).toBe(2);
      expect(LogLevel.DEBUG).toBe(3);
    });
  });

  describe('Version constant', () => {
    it('should export version constant', async () => {
      const { MCP_WORDPRESS_REMOTE_VERSION } = await import('../../src/lib/utils.js');
      
      expect(MCP_WORDPRESS_REMOTE_VERSION).toBe('0.2.1');
    });
  });

  describe('Log function', () => {
    it('should log messages with correct format', async () => {
      const { log, LogLevel } = await import('../../src/lib/utils.js');
      
      log('Test message', LogLevel.INFO, 'TEST');
      
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[INFO\] \[TEST\] Test message\n$/)
      );
    });

    it('should log with default level and category', async () => {
      const { log } = await import('../../src/lib/utils.js');
      
      log('Default test');
      
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringMatching(/\[INFO\] \[GENERAL\] Default test\n$/)
      );
    });

    it('should include additional arguments in log output', async () => {
      restoreEnv = mockEnv({
        LOG_LEVEL: '3', // DEBUG level to see the message
      });
      
      const { log, LogLevel } = await import('../../src/lib/utils.js');
      
      const testObj = { key: 'value', number: 42 };
      log('Test with args', LogLevel.DEBUG, 'TEST', testObj, 'string arg');
      
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringMatching(/Test with args\n.*"key":\s*"value".*string arg/s)
      );
    });

    it('should respect log level filtering', async () => {
      restoreEnv = mockEnv({
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
        NODE_ENV: 'development',
      });
      
      const { log, LogLevel } = await import('../../src/lib/utils.js');
      
      // In development, DEBUG messages should be logged
      log('Debug message', LogLevel.DEBUG, 'TEST');
      
      expect(process.stderr.write).toHaveBeenCalled();
    });

    it('should use INFO level by default in non-development', async () => {
      restoreEnv = mockEnv({
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
    it('should provide error logging function', async () => {
      const { logger } = await import('../../src/lib/utils.js');
      
      logger.error('Error message', 'CUSTOM', { error: 'data' });
      
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringMatching(/\[ERROR\] \[CUSTOM\] Error message\n.*"error":\s*"data"/s)
      );
    });

    it('should provide warn logging function', async () => {
      const { logger } = await import('../../src/lib/utils.js');
      
      logger.warn('Warning message');
      
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringMatching(/\[WARN\] \[WARN\] Warning message\n$/)
      );
    });

    it('should provide info logging function', async () => {
      const { logger } = await import('../../src/lib/utils.js');
      
      logger.info('Info message');
      
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringMatching(/\[INFO\] \[INFO\] Info message\n$/)
      );
    });

    it('should provide debug logging function', async () => {
      restoreEnv = mockEnv({
        LOG_LEVEL: '3', // DEBUG level
      });
      
      const { logger } = await import('../../src/lib/utils.js');
      
      logger.debug('Debug message');
      
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringMatching(/\[DEBUG\] \[DEBUG\] Debug message\n$/)
      );
    });

    describe('Specialized category loggers', () => {
      beforeEach(() => {
        restoreEnv = mockEnv({
          LOG_LEVEL: '3', // DEBUG level to see all messages
        });
      });

      it('should provide auth logger', async () => {
        const { logger } = await import('../../src/lib/utils.js');
        
        logger.auth('Auth message');
        
        expect(process.stderr.write).toHaveBeenCalledWith(
          expect.stringMatching(/\[INFO\] \[AUTH\] Auth message\n$/)
        );
      });

      it('should provide oauth logger', async () => {
        const { logger } = await import('../../src/lib/utils.js');
        
        logger.oauth('OAuth message');
        
        expect(process.stderr.write).toHaveBeenCalledWith(
          expect.stringMatching(/\[INFO\] \[OAUTH\] OAuth message\n$/)
        );
      });

      it('should provide api logger', async () => {
        const { logger } = await import('../../src/lib/utils.js');
        
        logger.api('API message');
        
        expect(process.stderr.write).toHaveBeenCalledWith(
          expect.stringMatching(/\[INFO\] \[API\] API message\n$/)
        );
      });

      it('should provide config logger', async () => {
        const { logger } = await import('../../src/lib/utils.js');
        
        logger.config('Config message');
        
        expect(process.stderr.write).toHaveBeenCalledWith(
          expect.stringMatching(/\[INFO\] \[CONFIG\] Config message\n$/)
        );
      });

      it('should allow custom log levels in specialized loggers', async () => {
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
    it('should generate consistent SHA-256 hash for server URL', async () => {
      const { getServerUrlHash } = await import('../../src/lib/utils.js');
      
      const serverUrl = 'https://example.com';
      const hash1 = getServerUrlHash(serverUrl);
      const hash2 = getServerUrlHash(serverUrl);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(8); // Substring of SHA-256 hex
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
      const { createCoordinatorServer } = await import('../../src/lib/utils.js');
      
      const { server } = createCoordinatorServer(0);
      
      // Wait a bit for the server to start
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringMatching(/Coordinator server listening on port/)
      );
      
      // Cleanup
      server.close();
    });
  });

  describe('Remote server connection', () => {
    it('should create SSE transport with correct URL and headers', async () => {
      const { connectToRemoteServer } = await import('../../src/lib/utils.js');
      
      const serverUrl = 'https://example.com/sse';
      const headers = { 'Authorization': 'Bearer token' };
      
      const transport = await connectToRemoteServer(serverUrl, headers);
      
      expect(transport).toBeDefined();
      expect(transport.onmessage).toBeDefined();
      expect(transport.onerror).toBeDefined();
      expect(transport.onclose).toBeDefined();
    });

    it('should set up message handlers on transport', async () => {
      const { connectToRemoteServer } = await import('../../src/lib/utils.js');
      
      const transport = await connectToRemoteServer('https://example.com/sse', {});
      
      // Test message handler
      const testMessage = { type: 'test' } as any;
      if (transport.onmessage) {
        transport.onmessage(testMessage);
      }
      
      // Test error handler
      const testError = new Error('Test error');
      if (transport.onerror) {
        transport.onerror(testError);
      }
      
      // Test close handler
      if (transport.onclose) {
        transport.onclose();
      }
      
      // Should not throw errors
      expect(true).toBe(true);
    });
  });

  describe('MCP Proxy', () => {
    it('should handle incoming messages from client', async () => {
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

    it('should handle errors in message processing', async () => {
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
      
      // Simulate incoming message
      const testMessage = {
        id: 'test-id',
        method: 'test-method',
        params: {},
      };
      
      await mockTransport.onmessage(testMessage);
      
      expect(mockTransport.send).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        id: 'test-id',
        error: {
          code: -32000,
          message: 'Request failed',
        },
      });
    });

    it('should handle non-Error exceptions', async () => {
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
      
      // Simulate incoming message
      const testMessage = {
        id: 'test-id',
        method: 'test-method',
        params: {},
      };
      
      await mockTransport.onmessage(testMessage);
      
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
      const testMessage = {
        id: 'test-id',
        params: {},
      };
      
      await mockTransport.onmessage(testMessage);
      
      expect(mockWpRequest).not.toHaveBeenCalled();
      expect(mockTransport.send).not.toHaveBeenCalled();
    });
  });
});
