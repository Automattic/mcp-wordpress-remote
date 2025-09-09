/**
 * Node.js environment utilities for MCP WordPress Remote
 * 
 * Provides functions for Node.js version checking and environment validation
 */

import { logger } from './utils.js';

/**
 * Check if the current Node.js version meets the minimum requirement
 * 
 * @param requiredVersion The minimum required Node.js major version
 * @returns true if version is sufficient, false otherwise
 */
export function checkNodeVersion(requiredVersion: number = 18): boolean {
  const currentNodeVersion = parseInt(process.version.slice(1).split('.')[0]);
  return currentNodeVersion >= requiredVersion;
}

/**
 * Validate Node.js version and exit if insufficient
 * 
 * @param requiredVersion The minimum required Node.js major version
 */
export function validateNodeVersion(requiredVersion: number = 18): void {
  const currentNodeVersion = parseInt(process.version.slice(1).split('.')[0]);
  
  if (currentNodeVersion < requiredVersion) {
    logger.error(
      `This application requires Node.js version ${requiredVersion} or higher.`,
      'SYSTEM'
    );
    logger.error(`Current version: ${process.version}`, 'SYSTEM');
    process.exit(1);
  }
}

/**
 * Get the current Node.js version information
 * 
 * @returns Object containing version details
 */
export function getNodeVersionInfo() {
  const fullVersion = process.version;
  const majorVersion = parseInt(fullVersion.slice(1).split('.')[0]);
  const [, minor, patch] = fullVersion.slice(1).split('.').map(Number);
  
  return {
    full: fullVersion,
    major: majorVersion,
    minor: minor || 0,
    patch: patch || 0,
  };
}
