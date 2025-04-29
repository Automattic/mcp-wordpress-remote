#!/usr/bin/env node

/**
 * Setup script for the MCP WordPress Proxy
 *
 * This script helps users configure the MCP proxy by creating a configuration file
 * with the necessary environment variables.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log('MCP WordPress Proxy Setup');
console.log('=========================');
console.log('This script will help you configure the MCP proxy for your WordPress site.');
console.log('');

// Function to prompt for input
function prompt(question) {
  return new Promise(resolve => {
    rl.question(question, answer => {
      resolve(answer);
    });
  });
}

async function setup() {
  try {
    // Get WordPress site URL
    const wpUrl = await prompt('Enter your WordPress site URL (e.g., https://example.com): ');

    // Get WordPress username
    const username = await prompt('Enter your WordPress username: ');

    // Get WordPress application password
    const password = await prompt('Enter your WordPress application password: ');

    // Create configuration object
    const config = {
      mcpServers: {
        'mcp-wordpress-remote': {
          command: 'npx',
          args: ['mcp-wordpress-remote'],
          env: {
            WP_API_USERNAME: username,
            WP_API_PASSWORD: password,
            WP_API_URL: wpUrl,
          },
        },
      },
    };

    // Write configuration to file
    const configPath = path.join(__dirname, 'mcp-config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log('');
    console.log('Configuration saved to mcp-config.json');
    console.log('');
    console.log('Next steps:');
    console.log('1. Configure your MCP client to use this configuration file');
    console.log('2. Restart your MCP client');
  } catch (error) {
    console.error('Error setting up configuration:', error);
  } finally {
    rl.close();
  }
}

setup();
