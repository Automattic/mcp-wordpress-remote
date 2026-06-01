/**
 * Transport Detection Utilities for MCP WordPress Remote
 * 
 * Provides automatic detection of transport type (JSON-RPC vs Simple)
 */

import { logger } from './utils.js';
import { wpRequest, getSessionId } from './wordpress-api.js';
import { APIError } from './oauth-types.js';
import { InitializeResult } from './types.js';
import { TransportType } from './mcp-types.js';
import { addSessionInfo, SessionContext } from './session-utils.js';
import { MCP_WORDPRESS_REMOTE_VERSION } from './config.js';

export interface TransportDetectionResult {
  transportType: TransportType;
  initResult: InitializeResult;
  sessionId: string | null;
}

/**
 * Detect which transport type the WordPress server supports
 * Tries JSON-RPC first, falls back to simple format
 */
export async function detectTransportType(context: SessionContext, initParams?: any): Promise<TransportDetectionResult> {
  logger.info('🔍 Starting transport detection and WordPress API initialization...', 'TRANSPORT_DETECT');
  
  let init: InitializeResult;
  let transportType: TransportType = null;
  
  // Add proxy information to clientInfo
  const enhancedParams = initParams ? { ...initParams } : {};
  if (enhancedParams.clientInfo) {
    // Verify clientInfo is a non-null object (not an array)
    if (typeof enhancedParams.clientInfo === 'object' && enhancedParams.clientInfo !== null && !Array.isArray(enhancedParams.clientInfo)) {
      // Capture original client name before any mutation
      const originalClient = enhancedParams.clientInfo?.name || 'unknown';
      
      // Create a fresh newClientInfo object to avoid mutating the original
      const newClientInfo = { ...enhancedParams.clientInfo };
      
      // Add/merge the proxied field without clobbering an existing proxied object
      if (newClientInfo.proxied && typeof newClientInfo.proxied === 'object') {
        // If proxied already exists, merge with it
        newClientInfo.proxied = {
          ...newClientInfo.proxied,
          name: '@automattic/mcp-wordpress-remote',
          version: MCP_WORDPRESS_REMOTE_VERSION
        };
      } else {
        // If no proxied field exists, create it
        newClientInfo.proxied = {
          name: '@automattic/mcp-wordpress-remote',
          version: MCP_WORDPRESS_REMOTE_VERSION
        };
      }
      
      // Assign the new clientInfo to enhancedParams (original initParams remains unchanged)
      enhancedParams.clientInfo = newClientInfo;
      
      logger.info('📋 Added proxy information to clientInfo', 'TRANSPORT_DETECT', {
        originalClient,
        proxyName: '@automattic/mcp-wordpress-remote',
        proxyVersion: MCP_WORDPRESS_REMOTE_VERSION
      });
    } else {
      logger.warn('clientInfo is present but not a valid object, skipping enhancement', 'TRANSPORT_DETECT', {
        clientInfoType: typeof enhancedParams.clientInfo,
        isArray: Array.isArray(enhancedParams.clientInfo),
        isNull: enhancedParams.clientInfo === null
      });
    }
  } else {
    logger.debug('No clientInfo provided in initialize parameters', 'TRANSPORT_DETECT');
  }
  
  try {
    // First, try JSON-RPC format
    logger.info('📡 Attempting JSON-RPC transport...', 'TRANSPORT_DETECT');
    
    // Prepare the initialize request with client parameters
    // Include client params in wpRequestParams so they end up in the JSON-RPC params field
    const wpRequestParams = {
      method: 'initialize',
      ...enhancedParams
    };
    
    const initMessage = addSessionInfo(wpRequestParams, {}, context);
    
    logger.info('Sending initialization message via JSON-RPC:', 'TRANSPORT_DETECT', {
      method: initMessage.method,
      id: initMessage.id,
      jsonrpc: initMessage.jsonrpc,
      hasParams: !!initMessage.params && Object.keys(initMessage.params).length > 1, // More than just _proxy_request_id
    });
    logger.debug('Complete JSON-RPC init message:', 'TRANSPORT_DETECT', initMessage);
    
    const initResponse = await wpRequest(initMessage, true); // Use JSON-RPC
    init = initResponse as InitializeResult;
    transportType = 'jsonrpc';
    
    logger.info('✅ JSON-RPC transport detected and working', 'TRANSPORT_DETECT');
    logger.debug('JSON-RPC initialization response:', 'TRANSPORT_DETECT', init);
  } catch (error) {
    // A timeout means the upstream is unreachable or stalled, not that it
    // speaks a different transport. Retrying with simple transport would just
    // hang for another full timeout, so fail fast and preserve the cause.
    if (error instanceof APIError && error.code === 'ETIMEDOUT') {
      logger.error(
        '❌ JSON-RPC transport timed out; skipping simple transport fallback',
        'TRANSPORT_DETECT',
        error
      );
      const connectionError = new Error('WordPress connection timed out during initialization');
      (connectionError as { cause?: unknown }).cause = error;
      throw connectionError;
    }

    // If JSON-RPC fails for another reason, try simple format
    logger.warn('⚠️  JSON-RPC transport failed, trying simple transport...', 'TRANSPORT_DETECT');
    logger.debug('JSON-RPC error details:', 'TRANSPORT_DETECT', error);
    
    try {
      // For simple transport, use the same enhanced params structure
      const simpleRequestParams = {
        method: 'initialize',
        ...enhancedParams
      };
      
      logger.info('Sending initialization message via Simple transport:', 'TRANSPORT_DETECT', {
        method: simpleRequestParams.method,
        hasParams: Object.keys(simpleRequestParams).length > 1,
      });
      logger.debug('Complete Simple init message:', 'TRANSPORT_DETECT', simpleRequestParams);
      
      const initResponse = await wpRequest(simpleRequestParams, false); // Use simple format
      init = initResponse as InitializeResult;
      transportType = 'simple';
      
      logger.info('✅ Simple transport detected and working', 'TRANSPORT_DETECT');
      logger.debug('Simple initialization response:', 'TRANSPORT_DETECT', init);
    } catch (simpleError) {
      logger.error('❌ Both JSON-RPC and simple transports failed', 'TRANSPORT_DETECT', simpleError);
      // Preserve the underlying failure as `cause` so the init handler can
      // surface the real reason (TLS, DNS, refused) instead of a generic message.
      // Assigned post-construction because the tsconfig lib predates the
      // two-argument Error constructor.
      const connectionError = new Error('Unable to establish connection with either transport type');
      (connectionError as { cause?: unknown }).cause = simpleError;
      throw connectionError;
    }
  }
  
  // Update context with detected transport type
  context.transportType = transportType;
  
  // Get the session ID that WordPress provided
  const sessionId = getSessionId();
  context.sessionId = sessionId;
  
  if (sessionId) {
    logger.info(`Using session ID from WordPress: ${sessionId}`, 'PROXY');
  } else {
    logger.warn('No session ID received from WordPress - continuing without session', 'PROXY');
  }
  
  logger.info(`WordPress connection initialized successfully using ${transportType} transport`, 'PROXY');

  return {
    transportType,
    initResult: init,
    sessionId,
  };
}
