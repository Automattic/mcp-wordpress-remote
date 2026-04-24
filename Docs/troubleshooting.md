# Troubleshooting Guide

This document provides troubleshooting tips for common issues encountered when using mcp-wordpress-remote to connect to an MCP enabled WordPress site.

## Node.js Version Issues with MCP and nvm

Due to a bug in [the MCP server implementation](https://github.com/modelcontextprotocol/servers/issues/64), you may encounter issues connecting to your MCP-enabled WordPress site if you have multiple Node.js versions installed via `nvm` (Node Version Manager). 

The MCP server requires a specific version of Node.js to function correctly. If you have older versions installed, `npx` may default to using one of those versions instead of the one set as default in your `nvm` configuration.

You can resolve this by ensuring that the correct `npx` version is being used to make the connection.

Use the following command to check which version of npx is being used:

```bash
which npx
```

The output should point to the installed `npx` binary configured as your computer's default. 

```php
/Users/username/.nvm/versions/node/v22.16.0/bin/npx
```

This must be version 22 or later. 

You can then update your MCP server configuration to use the full path for `npx`. Below is an example configuration for Cursor:

```php
{
	"mcpServers": {
		"wordpress": {
			"command": "/Users/username/.nvm/versions/node/v22.16.0/bin/npx",
			"args": [ "-y", "@automattic/mcp-wordpress-remote@latest" ],
			"env": {
				"WP_API_URL": "https://example.test/wp-json/mcp/mcp-adapter-default-server",
				"JWT_TOKEN": "{your_jwt-token-here}",
			}
		}
	}
}
```

# Local development environments and SSL

If you use a local development environment with a self-signed SSL certificate, you may [encounter issues with the MCP server connecting to your WordPress site](https://stackoverflow.com/questions/79669669/how-can-i-get-claude-code-to-trust-my-local-mcp-servers-self-signed-cert).

You can work around this by setting the `NODE_TLS_REJECT_UNAUTHORIZED` environment variable to `0` in your MCP server configuration. This will disable SSL certificate validation, allowing the MCP server to connect to your local WordPress site without issues.

```php
{
	"mcpServers": {
		"wordpress": {
			"command": "/Users/username/.nvm/versions/node/v22.16.0/bin/npx",
			"args": [ "-y", "@automattic/mcp-wordpress-remote@latest" ],
			"env": {
			    "NODE_TLS_REJECT_UNAUTHORIZED": "0",
				"WP_API_URL": "https://example.test/wp-json/mcp/mcp-adapter-default-server",
				"JWT_TOKEN": "{your_jwt-token-here}",
			}
		}
	}
}
```
