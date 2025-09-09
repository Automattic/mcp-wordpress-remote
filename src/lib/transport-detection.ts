/**
 * Transport Detection Utilities for MCP WordPress Remote
 * 
 * Provides automatic detection of transport type (JSON-RPC vs Simple)
 */

import { logger } from './utils.js';
import { wpRequest, getSessionId } from './wordpress-api.js';
import { InitializeResult } from './types.js';
import { TransportType } from './mcp-types.js';
import { addSessionInfo, SessionContext } from './session-utils.js';

export interface TransportDetectionResult {
  transportType: TransportType;
  initResult: InitializeResult;
  sessionId: string | null;
}

/**
 * Detect which transport type the WordPress server supports
 * Tries JSON-RPC first, falls back to simple format
 */
export async function detectTransportType(context: SessionContext): Promise<TransportDetectionResult> {
  logger.info('Initializing connection to WordPress API with transport detection...', 'PROXY');
  
  let init: InitializeResult;
  let transportType: TransportType = null;
  
  try {
    // First, try JSON-RPC format
    logger.info('Attempting JSON-RPC transport...', 'PROXY');
    const initMessage = addSessionInfo({ method: 'initialize' }, {}, context);
    const initResponse = await wpRequest(initMessage, true); // Use JSON-RPC
    init = initResponse as InitializeResult;
    transportType = 'jsonrpc';
    logger.info('✅ JSON-RPC transport detected and working', 'PROXY');
  } catch (error) {
    // If JSON-RPC fails, try simple format
    logger.warn('JSON-RPC transport failed, trying simple transport...', 'PROXY');
    logger.debug('JSON-RPC error:', 'PROXY', error);
    
    try {
      const simpleInitRequest = { method: 'initialize' };
      const initResponse = await wpRequest(simpleInitRequest, false); // Use simple format
      init = initResponse as InitializeResult;
      transportType = 'simple';
      logger.info('✅ Simple transport detected and working', 'PROXY');
    } catch (simpleError) {
      logger.error('Both JSON-RPC and simple transports failed', 'PROXY', simpleError);
      throw new Error('Unable to establish connection with either transport type');
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
