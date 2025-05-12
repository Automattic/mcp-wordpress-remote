import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHash } from 'crypto';
import { createServer } from 'http';
import { WordPressRequestParams, WordPressResponse } from './types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import express from 'express';
import { EventEmitter } from 'events';

// Version of the package
export const MCP_WORDPRESS_REMOTE_VERSION = '1.0.0';

// Logging configuration
const logFile = process.env.LOG_FILE || null;

// Ensure the log directory exists if logging to the file is enabled
if (logFile) {
  const logDir = path.dirname(logFile);
  if (!fs.existsSync(logFile)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

/**
 * Log a message to the console and optionally to a file
 *
 * @param message - The message to log
 * @param args - Additional arguments to log
 */
export function log(message: string, ...args: any[]): void {
  const timestamp = new Date().toISOString();
  const formattedArgs =
    args.length > 0
      ? args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' ')
      : '';

  const logMessage = `${timestamp}: ${message}${formattedArgs ? ' ' + formattedArgs : ''}\n`;

  // Log to file only if LOG_FILE or LOG_DIR is provided
  if (logFile) {
    fs.appendFileSync(logFile, logMessage);
  }
}

/**
 * Set up signal handlers for cleanup
 */
export function setupSignalHandlers(cleanup: () => Promise<void>): void {
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  signals.forEach(signal => {
    process.on(signal, async () => {
      log(`\nReceived ${signal}, cleaning up...`);
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
    log(`Coordinator server listening on port ${port}`);
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
    log('Received message:', JSON.stringify(message, null, 2));
  };

  transport.onerror = error => {
    log('Transport error:', error);
  };

  transport.onclose = () => {
    log('Connection closed.');
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

/**
 * Sets up an Express server to handle the OAuth callback with long polling
 * @param options Configuration options for the server
 * @returns An object with the server, waitForAuthCode function, and authCompletedPromise
 */
export function setupOAuthCallbackServerWithLongPoll(options: {
  port: number;
  path: string;
  events: EventEmitter;
}) {
  const app = express();
  const server = app.listen(options.port);
  let authCode: string | null = null;
  let authCompleted = false;

  app.get(options.path, (req, res) => {
    const code = req.query.code as string;
    if (code) {
      authCode = code;
      authCompleted = true;
      options.events.emit('authCompleted', code);
      res.send('Authentication completed. You can close this window.');
    } else {
      res.status(400).send('No code provided');
    }
  });

  app.get('/wait-for-auth', (req, res) => {
    if (authCompleted) {
      res.status(200).send('Auth completed');
    } else {
      res.status(202).send('Auth in progress');
    }
  });

  const waitForAuthCode = () => {
    return new Promise<string>(resolve => {
      if (authCode) {
        resolve(authCode);
      } else {
        options.events.once('authCompleted', code => {
          resolve(code);
        });
      }
    });
  };

  const authCompletedPromise = new Promise<void>(resolve => {
    if (authCompleted) {
      resolve();
    } else {
      options.events.once('authCompleted', () => {
        resolve();
      });
    }
  });

  return { server, waitForAuthCode, authCompletedPromise };
}
