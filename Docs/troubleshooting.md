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

If your WordPress site uses a certificate signed by a CA that your operating system trusts but Node.js does not — for example `mkcert` (DDEV, Laravel Valet), a corporate CA, or a VPN — the proxy will fail to connect. Node ships its own bundled CA list and ignores the OS trust store by default, so the certificate is rejected even though `curl` and your browser accept it.

Symptoms: the MCP client shows "Connection Failed", and the proxy logs an error such as `UNABLE_TO_VERIFY_LEAF_SIGNATURE` or `SELF_SIGNED_CERT_IN_CHAIN` on stderr (error-level logs are always written to stderr).

Fix it by making Node trust the CA. In order of preference:

1. **Point Node at the CA file** with `NODE_EXTRA_CA_CERTS`. For `mkcert`, find the path with `mkcert -CAROOT` (the file is `rootCA.pem` inside that directory). This keeps certificate validation enabled.

   ```json
   {
   	"mcpServers": {
   		"wordpress": {
   			"command": "/Users/username/.nvm/versions/node/v22.16.0/bin/npx",
   			"args": [ "-y", "@automattic/mcp-wordpress-remote@latest" ],
   			"env": {
   				"NODE_EXTRA_CA_CERTS": "/Users/username/Library/Application Support/mkcert/rootCA.pem",
   				"WP_API_URL": "https://example.test/wp-json/mcp/mcp-adapter-default-server",
   				"JWT_TOKEN": "{your_jwt-token-here}"
   			}
   		}
   	}
   }
   ```

2. **Trust the OS certificate store** with `NODE_USE_SYSTEM_CA=1` (Node 22.15+, 23.9+, or 24+). This works for any CA already installed in the OS, with no file path to manage.

   ```json
   "env": {
   	"NODE_USE_SYSTEM_CA": "1",
   	"WP_API_URL": "https://example.test/wp-json/mcp/mcp-adapter-default-server",
   	"JWT_TOKEN": "{your_jwt-token-here}"
   }
   ```

3. **Insecure last resort:** set `NODE_TLS_REJECT_UNAUTHORIZED` to `0`. This disables all certificate validation and exposes the connection to man-in-the-middle attacks. Use it only for throwaway local testing, never against a real or remote site.

   ```json
   "env": {
   	"NODE_TLS_REJECT_UNAUTHORIZED": "0",
   	"WP_API_URL": "https://example.test/wp-json/mcp/mcp-adapter-default-server",
   	"JWT_TOKEN": "{your_jwt-token-here}"
   }
   ```

After changing the environment, restart your MCP client so the proxy is relaunched with the new variables.

# Connection hangs at startup

If the MCP client shows the server "connecting" for a long time and then times out, the proxy is likely waiting on an upstream that never responds — a stalled TLS handshake, a blackholed route, or a dead proxy. The proxy bounds this wait: the `initialize` handshake fails after `WP_API_INIT_TIMEOUT_MS` (default 25 seconds) and logs the reason to stderr, rather than hanging until the operating system's TCP timeout.

If your network is slow and legitimate requests need longer, raise the limits:

```json
"env": {
	"WP_API_INIT_TIMEOUT_MS": "40000",
	"WP_API_TIMEOUT_MS": "180000"
}
```

`WP_API_INIT_TIMEOUT_MS` bounds the startup handshake; `WP_API_TIMEOUT_MS` bounds individual tool calls.
