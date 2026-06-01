#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { logger } from './lib/utils.js';
import { cleanupExpiredTokens } from './lib/persistent-auth-config.js';
import { validateNodeVersion } from './lib/node-utils.js';
import { setupFetchPolyfill } from './lib/fetch-utils.js';
import { detectTransportType } from './lib/transport-detection.js';
import { createSessionContext, resolveInit } from './lib/session-utils.js';
import { describeConnectionError } from './lib/error-utils.js';
import { createWrappedHandler, HANDLER_CONFIGS } from './lib/request-handler-factory.js';
import { MCP_WORDPRESS_REMOTE_VERSION } from './lib/config.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  SetLevelRequestSchema,
  CompleteRequestSchema,
  ListRootsRequestSchema,
} from './lib/mcp-types.js';
import { InitializeRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Check Node.js version
validateNodeVersion(18);

/**
 * Enhanced Client Message Logging
 *
 * This proxy now includes comprehensive logging for all client messages at multiple levels:
 *
 * 1. TRANSPORT level: Raw messages from the transport layer
 * 2. CLIENT level: Processed messages with structured information
 * 3. TRANSPORT_DETECT level: Initialization and transport detection messages
 *
 * Log levels:
 * - INFO: Basic request/response information with emojis for easy scanning
 * - DEBUG: Complete message objects and detailed debugging info
 * - ERROR: Failed requests and transport errors
 *
 * To control logging:
 * - Set LOG_LEVEL=0 (ERROR), 1 (WARN), 2 (INFO), or 3 (DEBUG)
 * - Set LOG_FILE=path/to/file.log to also log to a file
 * - In development, DEBUG level is default; in production, INFO level is default
 */

async function WordPressProxy() {
  // Setup fetch polyfill before doing anything else
  await setupFetchPolyfill();

  logger.info('Starting WordPress MCP Proxy with enhanced authentication', 'PROXY');

  // Clean up any expired tokens on startup
  try {
    await cleanupExpiredTokens();
  } catch (error) {
    logger.warn('Error cleaning up expired tokens', 'PROXY', error);
  }

  // Create session context
  const sessionContext = createSessionContext();

  // Create server with minimal default info (will be updated with actual WordPress info on first initialize)
  const server = new Server(
    {
      name: 'WordPress MCP Remote Proxy',
      version: MCP_WORDPRESS_REMOTE_VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        logging: {},
        completions: {},
      },
    }
  );

  // Handle initialize request by forwarding client parameters to WordPress (only one call)
  server.setRequestHandler(InitializeRequestSchema, async request => {
    logger.info('📩 Client Initialize Request received', 'INIT');
    logger.debug('Initialize request details:', 'INIT', request);

    try {
      // Forward the client's initialize parameters to WordPress server (first and only call)
      logger.info('🔄 Initializing WordPress connection with client parameters', 'INIT');
      const { initResult } = await detectTransportType(sessionContext, request.params);

      // Signal that init is complete — unblocks any handlers waiting on waitForInit
      resolveInit(sessionContext, false);

      // Return the WordPress server's initialize response
      const wordpressInitResponse = {
        protocolVersion: initResult.protocolVersion || '2025-06-18',
        serverInfo: initResult.serverInfo,
        capabilities: initResult.capabilities,
        instructions: initResult.instructions || 'MCP WordPress Remote Proxy Server',
      };

      logger.info('✅ Returning WordPress server initialize response', 'INIT');
      logger.debug('Initialize response:', 'INIT', wordpressInitResponse);

      return wordpressInitResponse;
    } catch (error) {
      logger.error(
        '❌ Failed to initialize WordPress connection with client parameters',
        'INIT',
        error
      );

      // Describe the real cause (TLS/DNS/refused) — unwrap the `cause` set by
      // transport detection — so logs and the client see the underlying error
      // instead of a generic "connection failed".
      const cause = (error as { cause?: unknown })?.cause ?? error;
      const connectionError = describeConnectionError(cause);
      if (connectionError.hint) {
        logger.error(connectionError.hint, 'INIT');
      }

      // Mark init as failed and unblock waiting handlers (they'll return errors
      // carrying these details to the client).
      resolveInit(sessionContext, true, connectionError);

      const clientProtocolVersion = request?.params?.protocolVersion || '2025-06-18';

      // Return a fallback response with empty capabilities so the SDK
      // doesn't try to list tools/resources/prompts for a dead connection.
      // `experimental.connectionFailed` lets clients detect the degraded state
      // programmatically rather than string-matching the instructions field.
      const fallbackResponse = {
        protocolVersion: clientProtocolVersion,
        serverInfo: {
          name: 'WordPress MCP Remote Proxy',
          version: MCP_WORDPRESS_REMOTE_VERSION,
        },
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
          logging: {},
          completions: {},
          experimental: { connectionFailed: true },
        },
        instructions: `MCP WordPress Remote Proxy Server (Connection Failed${
          connectionError.code ? `: ${connectionError.code}` : ''
        })`,
      };

      logger.warn('⚠️ Using fallback initialize response', 'INIT');
      return fallbackResponse;
    }
  });

  // Register all other MCP request handlers using the factory
  server.setRequestHandler(
    ListToolsRequestSchema,
    createWrappedHandler(HANDLER_CONFIGS.listTools, sessionContext)
  );
  server.setRequestHandler(
    CallToolRequestSchema,
    createWrappedHandler(HANDLER_CONFIGS.callTool, sessionContext)
  );
  server.setRequestHandler(
    ListResourcesRequestSchema,
    createWrappedHandler(HANDLER_CONFIGS.listResources, sessionContext)
  );
  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    createWrappedHandler(HANDLER_CONFIGS.listResourceTemplates, sessionContext)
  );
  server.setRequestHandler(
    ReadResourceRequestSchema,
    createWrappedHandler(HANDLER_CONFIGS.readResource, sessionContext)
  );
  server.setRequestHandler(
    SubscribeRequestSchema,
    createWrappedHandler(HANDLER_CONFIGS.subscribe, sessionContext)
  );
  server.setRequestHandler(
    UnsubscribeRequestSchema,
    createWrappedHandler(HANDLER_CONFIGS.unsubscribe, sessionContext)
  );
  server.setRequestHandler(
    ListPromptsRequestSchema,
    createWrappedHandler(HANDLER_CONFIGS.listPrompts, sessionContext)
  );
  server.setRequestHandler(
    GetPromptRequestSchema,
    createWrappedHandler(HANDLER_CONFIGS.getPrompt, sessionContext)
  );
  server.setRequestHandler(
    SetLevelRequestSchema,
    createWrappedHandler(HANDLER_CONFIGS.setLevel, sessionContext)
  );
  server.setRequestHandler(
    CompleteRequestSchema,
    createWrappedHandler(HANDLER_CONFIGS.complete, sessionContext)
  );
  server.setRequestHandler(
    ListRootsRequestSchema,
    createWrappedHandler(HANDLER_CONFIGS.listRoots, sessionContext)
  );

  const transport = new StdioServerTransport();

  transport.onmessage = message => {
    const msg = message as unknown;
    const method = typeof (msg as any)?.method === 'string' ? (msg as any).method : 'unknown';
    const id = (msg as any)?.id ?? 'none';
    const hasParams = Boolean(
      (msg as any)?.params &&
        typeof (msg as any).params === 'object' &&
        Object.keys((msg as any).params).length
    );

    logger.info('📥 Raw client message received', 'TRANSPORT', {
      method,
      id,
      hasParams,
      messageType: method === 'unknown' ? 'response/notification' : 'request',
    });
    logger.debug('Complete raw message:', 'TRANSPORT', message);
  };

  transport.onerror = error => {
    logger.error('❌ Transport error:', 'TRANSPORT', error);
  };

  transport.onclose = () => {
    logger.info('🔌 Transport connection closed', 'TRANSPORT');
  };

  // Connect to the transport
  server
    .connect(transport)
    .then(() => {
      logger.info('MCP server connected to transport successfully', 'PROXY');
    })
    .catch(error => {
      logger.error('Error starting MCP server', 'PROXY', error);
      process.exit(1);
    });
}

WordPressProxy();
