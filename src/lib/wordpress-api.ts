/**
 * External dependencies
 */
import * as path from 'node:path';
import { WordPressRequestParams, WordPressResponse } from './types.js';
import { log } from './utils.js';

/**
 * WordPress API request function with basic auth support
 *
 * @param {Object} params - Query parameters for the request
 * @return {Promise<any>} API response as JSON
 */

function validateEnvironment() {
  const requiredEnvVars = ['WP_API_URL', 'WP_API_USERNAME', 'WP_API_PASSWORD'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(
        ', '
      )}. Please set these variables before starting the server.`
    );
  }
}

export async function wpRequest(
  params: WordPressRequestParams = { method: 'init' }
): Promise<WordPressResponse> {
  // Validate environment variables first
  validateEnvironment();

  const endpoint = 'wp/v2/wpmcp';
  const method = 'POST';
  const baseUrl = process.env.WP_API_URL!;

  // Log the request parameters for debugging
  log(`Request method: ${params.method || 'init'}`);
  log(`Request args: ${JSON.stringify(params.args || {})}`);

  // Determine which credentials to use based on the method and args
  let username: string;
  let password: string;

  if (
    params.method === 'tools/call' &&
    params.args &&
    params.args.tool &&
    params.args.tool.startsWith('wc_reports_')
  ) {
    // Use WooCommerce credentials for WooCommerce report tools
    username = process.env.WOO_CUSTOMER_KEY!;
    password = process.env.WOO_CUSTOMER_SECRET!;

    // Log which credentials are being used
    log(`Using WooCommerce credentials for tool: ${params.args.tool}`);

    // Validate WooCommerce credentials
    if (!username || !password) {
      throw new Error(
        'Missing WooCommerce credentials. Please set WOO_CUSTOMER_KEY and WOO_CUSTOMER_SECRET environment variables.'
      );
    }
  } else {
    // Use standard WordPress credentials for other methods
    username = process.env.WP_API_USERNAME!;
    password = process.env.WP_API_PASSWORD!;

    // Log which credentials are being used
    log(`Using WordPress credentials for method: ${params.method || 'init'}`);
  }

  // Log credential information (without exposing the actual values)
  log(`Username length: ${username ? username.length : 0}`);
  log(`Password length: ${password ? password.length : 0}`);

  log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  log(`API URL: ${baseUrl}`);

  // Prepare authorization header
  const auth = Buffer.from(`${username}:${password}`).toString('base64');
  log(`Auth header length: ${auth.length}`);

  // Build URL with query params for GET requests
  const url = new URL(`/wp-json/${endpoint}`, baseUrl).toString();
  log(`Requesting URL: ${url}`);

  const headers: Record<string, string> = {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/json',
  };

  const fetchOptions: RequestInit = {
    method,
    headers,
    body: JSON.stringify(params),
  };

  try {
    log(`Sending request to WordPress API...`);
    const response = await fetch(url, fetchOptions);
    log(`Response status: ${response.status}`);

    // Handle error responses
    if (!response.ok) {
      const errorText = await response.text();
      log(`Error response: ${errorText}`);
      throw new Error(`WordPress API error (${response.status}): ${errorText}`);
    }

    const responseData = await response.json();
    log(`Response received successfully`);
    return responseData as WordPressResponse;
  } catch (error) {
    log(`Error in wpRequest: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}
