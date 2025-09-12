# MCP WordPress Remote

**A Model Context Protocol (MCP) server for seamless WordPress integration**

Connect AI assistants like Claude Desktop to your WordPress sites with multiple authentication methods including OAuth 2.0, JWT tokens, and application passwords.

## Features

- **MCP Authorization Specification Compliant** - Implements MCP Authorization specification 2025-06-18
- **OAuth 2.1 with PKCE** - Secure authorization code flow with PKCE (RFC 7636)
- **Resource Indicators** - RFC 8707 compliance for token audience binding
- **Dynamic Client Registration** - RFC 7591 support for automatic client registration
- **Protected Resource Metadata Discovery** - RFC 9728 for automatic endpoint discovery
- **Multiple Authentication Methods** - OAuth 2.1, JWT tokens, and WordPress application passwords
- **Persistent Token Storage** - OAuth tokens stored securely with automatic validation
- **Multi-instance Coordination** - Lockfiles prevent authentication conflicts
- **Automatic Token Management** - Handles validation, refresh, and cleanup
- **Enhanced Error Handling** - Detailed error messages with proper categorization
- **Comprehensive Logging** - Structured logging with categories and levels
- **Complete MCP Support** - Tools, resources, prompts, and more

## Quick Start

### Installation

```bash
npm install @automattic/mcp-wordpress-remote
```

### Configuration

Add to your MCP client configuration (e.g., Claude Desktop's `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "wordpress": {
      "command": "npx",
      "args": ["-y", "@automattic/mcp-wordpress-remote"],
      "env": {
        "WP_API_URL": "https://your-wordpress-site.com"
      }
    }
  }
}
```

### Custom Headers

You can add custom headers to all API requests using the `CUSTOM_HEADERS` environment variable. This is useful for API keys, custom authentication, or other header requirements.

#### JSON Format (Recommended):
```json
{
  "mcpServers": {
    "wordpress": {
      "command": "npx",
      "args": ["-y", "@automattic/mcp-wordpress-remote"],
      "env": {
        "WP_API_URL": "https://your-wordpress-site.com",
        "CUSTOM_HEADERS": "{\"X-MCP-API-Key\": \"*Ibo7tweixlbfuwaiufxgakjyefctwajcetb*\", \"X-Custom-Header\": \"value\"}"
      }
    }
  }
}
```

#### Comma-Separated Format:
```json
{
  "mcpServers": {
    "wordpress": {
      "command": "npx",
      "args": ["-y", "@automattic/mcp-wordpress-remote"],
      "env": {
        "WP_API_URL": "https://your-wordpress-site.com",
        "CUSTOM_HEADERS": "X-MCP-API-Key:IOskncfyes78U8on3q7ry43o487tybrc,X-Custom-Header:value"
      }
    }
  }
}
```

#### Command Line Usage:
```bash
CUSTOM_HEADERS='{"X-MCP-API-Key": "wc_mcp_FaQduhQcW0mfVaZgP3yaaqDuXaZ3mw7j"}' \
WP_API_URL="https://your-site.com" \
npx @automattic/mcp-wordpress-remote
```

Custom headers are included in:
- All WordPress API requests
- OAuth discovery requests
- OAuth token exchange requests
- OAuth client registration requests

### First Run

1. **Start your MCP client** (Claude Desktop, etc.)
2. **Choose authentication method** based on your preference:
   - **OAuth 2.0** (default): Browser opens automatically for authorization
   - **JWT Token**: Set `JWT_TOKEN` environment variable
   - **Application Password**: Set `WP_API_USERNAME` and `WP_API_PASSWORD`
3. **Start using WordPress features** in your AI assistant

## WordPress MCP Plugin

You need to install the [wordpress-mcp](https://github.com/Automattic/wordpress-mcp) plugin on your WordPress website and enable MCP Functionality in Settings > MCP Settings.

## Authentication Methods

### 1. OAuth 2.1 (Recommended - MCP Compliant)

OAuth 2.1 provides the most secure and user-friendly experience with full MCP Authorization specification compliance.

#### **For Self-Hosted WordPress Sites:**

```json
{
  "mcpServers": {
    "wordpress": {
      "command": "npx",
      "args": ["-y", "@automattic/mcp-wordpress-remote"],
      "env": {
        "WP_API_URL": "https://your-wordpress-site.com",
        "OAUTH_ENABLED": "true"
      }
    }
  }
}
```



**MCP Authorization Specification Features:**

- **OAuth 2.1 authorization code flow** with PKCE (RFC 7636)
- **Resource Indicators** (RFC 8707) for token audience binding
- **Dynamic Client Registration** (RFC 7591) when supported
- **Protected Resource Metadata Discovery** (RFC 9728)
- **Authorization Server Metadata Discovery** (RFC 8414)

**Benefits:**

- Full compliance with MCP Authorization specification 2025-06-18
- Enhanced security with PKCE protection
- One-time browser authorization
- Tokens stored securely with automatic validation
- Automatic endpoint discovery
- No need to manage passwords
- Automatic expiration handling

### 2. JWT Token Authentication

For server-to-server authentication or when OAuth is not available.

```json
{
  "mcpServers": {
    "wordpress": {
      "command": "npx",
      "args": ["-y", "@automattic/mcp-wordpress-remote"],
      "env": {
        "WP_API_URL": "https://your-wordpress-site.com",
        "JWT_TOKEN": "your-jwt-token-here"
      }
    }
  }
}
```

### 3. WordPress Application Passwords (Legacy)

Uses WordPress username and application password for basic authentication.

```json
{
  "mcpServers": {
    "wordpress": {
      "command": "npx",
      "args": ["-y", "@automattic/mcp-wordpress-remote"],
      "env": {
        "WP_API_URL": "https://your-wordpress-site.com",
        "WP_API_USERNAME": "your-username",
        "WP_API_PASSWORD": "your-application-password",
        "OAUTH_ENABLED": "false"
      }
    }
  }
}
```

To create an application password:

1. Go to your WordPress admin dashboard
2. Navigate to Users > Profile
3. Scroll down to "Application Passwords"
4. Create a new application password for MCP access

## Advanced Configuration

### Custom OAuth Settings

```json
{
  "mcpServers": {
    "wordpress": {
      "command": "npx",
      "args": ["-y", "@automattic/mcp-wordpress-remote"],
      "env": {
        "WP_API_URL": "https://your-wordpress-site.com",
        "OAUTH_CALLBACK_PORT": "7665",
        "OAUTH_HOST": "127.0.0.1",
        "WP_OAUTH_CLIENT_ID": "your-custom-client-id"
      }
    }
  }
}
```

### WooCommerce Integration

For WooCommerce-specific tools and reports:

```json
{
  "mcpServers": {
    "wordpress": {
      "command": "npx",
      "args": ["-y", "@automattic/mcp-wordpress-remote"],
      "env": {
        "WP_API_URL": "https://your-wordpress-site.com",
        "WOO_CUSTOMER_KEY": "ck_your-consumer-key",
        "WOO_CUSTOMER_SECRET": "cs_your-consumer-secret"
      }
    }
  }
}
```

### Environment Variables

| Variable                     | Description                        | Default              | Required |
| ---------------------------- | ---------------------------------- | -------------------- | -------- |
| `WP_API_URL`                 | WordPress site URL                 | -                    | ✅       |
| `OAUTH_ENABLED`              | Enable OAuth authentication        | `true`               | -        |
| `OAUTH_CALLBACK_PORT`        | OAuth callback port                | `7665`               | -        |
| `OAUTH_HOST`                 | OAuth callback hostname            | `127.0.0.1`          | -        |
| `WP_OAUTH_CLIENT_ID`         | Custom OAuth client ID             | -                    | -        |
| **OAuth Endpoints**          |                                    |                      |          |
| `OAUTH_AUTHORIZE_ENDPOINT`   | OAuth authorization endpoint       | -                    | ✅ (for custom OAuth) |
| `OAUTH_TOKEN_ENDPOINT`       | OAuth token endpoint               | -                    | ✅ (for custom OAuth) |
| `OAUTH_AUTHENTICATE_ENDPOINT`| OAuth authenticate endpoint       | -                    | -        |
| **MCP OAuth 2.1 Settings**   |                                    |                      |          |
| `OAUTH_FLOW_TYPE`            | OAuth flow type (authorization_code or implicit) | `authorization_code` | -        |
| `OAUTH_USE_PKCE`             | Use PKCE (required for OAuth 2.1)  | `true`               | -        |
| `OAUTH_DYNAMIC_REGISTRATION` | Enable dynamic client registration | `true`               | -        |
| `OAUTH_RESOURCE_INDICATOR`   | Use resource indicators (RFC 8707) | `true`               | -        |
| **Configuration**            |                                    |                      |          |
| `WP_MCP_CONFIG_DIR`          | Config directory override          | `~/.mcp-auth`        | -        |
| `LOG_FILE`                   | Log file path                      | -                    | -        |
| `LOG_LEVEL`                  | Log level (0-3)                    | `2`                  | -        |
| **Legacy Authentication**    |                                    |                      |          |
| `JWT_TOKEN`                  | JWT token for authentication       | -                    | -        |
| `WP_API_USERNAME`            | WordPress username (legacy)        | -                    | -        |
| `WP_API_PASSWORD`            | WordPress app password (legacy)    | -                    | -        |
| `WOO_CUSTOMER_KEY`           | WooCommerce consumer key           | -                    | -        |
| `WOO_CUSTOMER_SECRET`        | WooCommerce consumer secret        | -                    | -        |



### Disable OAuth

To use only JWT or Basic Auth:

```json
{
  "env": {
    "OAUTH_ENABLED": "false",
    "JWT_TOKEN": "your-jwt-token"
  }
}
```

## Development Mode

For development and testing, you can use the local repository:

### Setup

1. **Clone the repository:**

   ```bash
   git clone https://github.com/Automattic/mcp-wordpress-remote.git
   cd mcp-wordpress-remote
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Build the project:**
   ```bash
   npm run build
   ```

### Configuration

Configure your MCP client to use the local version:

```json
{
  "mcpServers": {
    "wordpress": {
      "command": "node",
      "args": ["/path/to/your/mcp-wordpress-remote/dist/proxy.js"],
      "env": {
        "WP_API_URL": "https://your-wordpress-site.com"
      }
    }
  }
}
```

### Development Workflow

- **Watch mode:** `npm run build:watch` - Automatically rebuilds on file changes
- **Testing:** `npm test` - Run the test suite
- **Type checking:** `npm run check` - Run TypeScript and Prettier checks

## Token Management

### OAuth Token Storage

Tokens are automatically stored in:

```
~/.mcp-auth/wordpress-remote-{version}/
```

### Manual Management

```bash
# View stored tokens
ls -la ~/.mcp-auth/wordpress-remote-*/

# Clear all tokens (forces re-authentication)
rm -rf ~/.mcp-auth/wordpress-remote-*/

# Clear tokens for specific version
rm -rf ~/.mcp-auth/wordpress-remote-0.2.1/
```

### Token Security

- **Secure file permissions** (600) on all token files
- **Automatic token validation** before each request
- **Expired token cleanup** during startup
- **Version isolation** - each version stores tokens separately

## Multi-Instance Support

The proxy automatically coordinates between multiple instances:

- **Lockfiles** prevent simultaneous OAuth flows
- **Process coordination** ensures only one authentication at a time
- **Graceful waiting** when another instance is authenticating
- **Automatic cleanup** of stale locks

If you see "waiting for other instance" messages, this is normal behavior.

## Troubleshooting

### Authentication Issues

**OAuth browser doesn't open:**

- Check if port 3000 is available
- Try a different port with `OAUTH_CALLBACK_PORT`
- Manually open the URL shown in logs

**OAuth authorization fails:**

- Verify WordPress site has MCP plugin installed and enabled
- Check WordPress admin user permissions
- Try clearing tokens and re-authenticating

**JWT authentication fails:**

- Verify JWT token is valid and not expired
- Check token format and encoding
- Ensure WordPress site supports JWT authentication

**Basic Auth fails:**

- Verify username and application password
- Check application password is active
- Ensure user has sufficient permissions

### Connection Issues

**API endpoint not found:**

- Verify WordPress MCP plugin is installed and activated
- Check plugin is enabled in WordPress admin
- Confirm `WP_API_URL` is correct

**Permission denied:**

- Check user permissions in WordPress
- Verify authentication credentials
- Review WordPress user roles

### Port Conflicts

If port 3000 is already in use:

```json
{
  "env": {
    "OAUTH_CALLBACK_PORT": "8080"
  }
}
```

### Multi-instance Messages

"Waiting for other instance" messages are normal when multiple MCP clients start simultaneously. The system coordinates authentication to prevent conflicts.

### Log Analysis

Enable detailed logging:

```json
{
  "env": {
    "LOG_LEVEL": "3",
    "LOG_FILE": "/path/to/logfile.log"
  }
}
```

Log levels:

- `0` - Errors only
- `1` - Warnings and errors
- `2` - Info, warnings, and errors (default)
- `3` - Debug, info, warnings, and errors

## Security Features

- **Secure OAuth flow** with state parameters and PKCE
- **Token encryption** with secure file permissions
- **Automatic validation** before each API request
- **Expired token cleanup** and refresh handling
- **Multi-instance coordination** prevents authentication conflicts

## Why Use MCP WordPress Remote?

1. **Multiple Authentication Methods** - Choose what works best for your setup
2. **Enhanced Security** - OAuth 2.0 with persistent token storage
3. **Better User Experience** - One-time setup with automatic token management
4. **Multi-Instance Support** - Works reliably with multiple MCP clients
5. **Comprehensive Logging** - Detailed logs for troubleshooting
6. **Easy Setup** - No global installation required with npx

## Requirements

- **Node.js 22+** (required for fetch API support)
- **WordPress site** with [wordpress-mcp](https://github.com/Automattic/wordpress-mcp) plugin
- **WordPress user account** with appropriate permissions

## License

GPL v2 or later

## Contributing

Contributions welcome! This project is maintained by Automattic Inc.

## Support

- **Issues:** [GitHub Issues](https://github.com/Automattic/mcp-wordpress-remote/issues)
- **Documentation:** Check the troubleshooting section above
- **WordPress MCP Plugin:** [Plugin Repository](https://github.com/Automattic/wordpress-mcp)

---

**Need help?** Check the [troubleshooting section](#troubleshooting) or open an issue.
