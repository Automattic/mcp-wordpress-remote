import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHash } from 'crypto';
import { createServer } from 'http';
import { WordPressRequestParams, WordPressResponse } from './types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Export version from config to maintain backward compatibility
export { MCP_WORDPRESS_REMOTE_VERSION } from './config.js';

// Log levels
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

// Current log level (can be overridden by environment)
const CURRENT_LOG_LEVEL = process.env.LOG_LEVEL
  ? parseInt(process.env.LOG_LEVEL)
  : (process.env.NODE_ENV || 'development') === 'development'
    ? LogLevel.DEBUG
    : LogLevel.INFO;

// Ensure log directory exists if logging to file is enabled
if (process.env.LOG_FILE) {
  const logDir = path.dirname(process.env.LOG_FILE);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

/**
 * Format a single log argument for output.
 *
 * Error instances are expanded explicitly because JSON.stringify drops their
 * most useful fields: `message` and `stack` are non-enumerable, so a plain
 * Error serializes to `{}`. Custom errors such as APIError keep their extra
 * own properties (statusCode, endpoint, response) which are merged in.
 *
 * @param arg - The argument to format
 * @returns A string representation suitable for the log line
 */
function formatLogArg(arg: any): string {
  if (arg instanceof Error) {
    const errorInfo: Record<string, unknown> = {
      name: arg.name,
      message: arg.message,
      stack: arg.stack,
    };

    // Merge in any extra own enumerable properties (e.g. statusCode, endpoint).
    for (const key of Object.keys(arg)) {
      if (!(key in errorInfo)) {
        errorInfo[key] = (arg as any)[key];
      }
    }

    return JSON.stringify(errorInfo, null, 2);
  }

  if (typeof arg === 'object' && arg !== null) {
    return JSON.stringify(arg, null, 2);
  }

  return String(arg);
}

/**
 * Enhanced logging function with levels and categories
 *
 * @param message - The message to log
 * @param level - Log level (default: INFO)
 * @param category - Log category for filtering (default: 'GENERAL')
 * @param args - Additional arguments to log
 */
export function log(
  message: string,
  level: LogLevel = LogLevel.INFO,
  category: string = 'GENERAL',
  ...args: any[]
): void {
  // Check if we should log at this level
  if (level > CURRENT_LOG_LEVEL) {
    return;
  }

  const timestamp = new Date().toISOString();
  const levelName = LogLevel[level];
  const formattedArgs = args.length > 0 ? args.map(formatLogArg).join(' ') : '';

  const logMessage = `${timestamp} [${levelName}] [${category}] ${message}${formattedArgs ? '\n' + formattedArgs : ''}\n`;

  // Log to stderr to avoid interfering with MCP JSON-RPC communication on stdout.
  // ERROR-level messages always go to stderr so failures are never silent —
  // a connection failure must be diagnosable without opting in to LOG_TO_STDERR.
  // Lower levels stay opt-in to avoid flooding stderr with routine logs.
  if (level === LogLevel.ERROR || process.env.LOG_TO_STDERR === 'true') {
    process.stderr.write(logMessage);
  }

  // Log to file only if LOG_FILE is provided
  if (process.env.LOG_FILE) {
    fs.appendFileSync(process.env.LOG_FILE, logMessage);
  }
}

/**
 * Convenience logging functions
 */
export const logger = {
  error: (message: string, category = 'ERROR', ...args: any[]) =>
    log(message, LogLevel.ERROR, category, ...args),
  warn: (message: string, category = 'WARN', ...args: any[]) =>
    log(message, LogLevel.WARN, category, ...args),
  info: (message: string, category = 'INFO', ...args: any[]) =>
    log(message, LogLevel.INFO, category, ...args),
  debug: (message: string, category = 'DEBUG', ...args: any[]) =>
    log(message, LogLevel.DEBUG, category, ...args),

  // Specialized category loggers
  auth: (message: string, level = LogLevel.INFO, ...args: any[]) =>
    log(message, level, 'AUTH', ...args),
  oauth: (message: string, level = LogLevel.INFO, ...args: any[]) =>
    log(message, level, 'OAUTH', ...args),
  api: (message: string, level = LogLevel.INFO, ...args: any[]) =>
    log(message, level, 'API', ...args),
  config: (message: string, level = LogLevel.INFO, ...args: any[]) =>
    log(message, level, 'CONFIG', ...args),
};

/**
 * Set up signal handlers for cleanup
 */
export function setupSignalHandlers(cleanup: () => Promise<void>): void {
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  signals.forEach(signal => {
    process.on(signal, async () => {
      logger.info(`Received ${signal}, cleaning up...`, 'SYSTEM');
      await cleanup();
      process.exit(0);
    });
  });
}

/**
 * Get a hash of the server URL for use in file paths
 */
export function getServerUrlHash(serverUrl: string): string {
  return createHash('sha256').update(serverUrl).digest('hex').substring(0, 8);
}

/**
 * Create a simple HTTP server for coordination
 */
export function createCoordinatorServer(port: number): { server: any; port: number } {
  const server = createServer();
  server.listen(port, () => {
    logger.info(`Coordinator server listening on port ${port}`, 'COORDINATION');
  });

  return { server, port };
}

/**
 * Connect to a remote MCP server
 */
export async function connectToRemoteServer(
  serverUrl: string,
  headers: Record<string, string>
): Promise<SSEClientTransport> {
  const url = new URL(serverUrl);
  const transport = new SSEClientTransport(url, { requestInit: { headers } });

  // Set up message and error handlers
  transport.onmessage = message => {
    logger.debug('Received message:', 'TRANSPORT', JSON.stringify(message, null, 2));
  };

  transport.onerror = error => {
    logger.error('Transport error:', 'TRANSPORT', error);
  };

  transport.onclose = () => {
    logger.info('Connection closed.', 'TRANSPORT');
  };

  return transport;
}

interface ProxyConfig {
  transportToClient: StdioServerTransport;
  wpRequest: (params: WordPressRequestParams) => Promise<WordPressResponse>;
}

export function mcpProxy({ transportToClient, wpRequest }: ProxyConfig) {
  // Handle incoming messages from the client
  transportToClient.onmessage = async (message: any) => {
    try {
      // Check if this is a request message
      if (message.method) {
        // Forward the request to WordPress API
        const response = await wpRequest({
          method: message.method,
          ...message.params,
        });

        // Send the response back to the client
        transportToClient.send({
          jsonrpc: '2.0',
          id: message.id,
          result: response,
        });
      }
    } catch (error) {
      // Handle errors and send error response to client
      transportToClient.send({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  };
}
