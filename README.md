# MCP WordPress Remote

A bidirectional proxy between a local STDIO MCP server and a remote WordPress MCP server.

## Usage

### Environment Variables

The following environment variables are required:

- `WP_API_URL`: The URL of your WordPress site (e.g., `https://example.com`)
- `WP_API_USERNAME`: Your WordPress username
- `WP_API_PASSWORD`: Your WordPress API password
- `WOO_CUSTOMER_KEY`: Your Woocommerce customer key
- `WOO_CUSTOMER_SECRET`: Your Woocommerce customer secret
- `LOG_FILE`: Optional log file

### Configuration in MCP Clients

#### Claude Desktop

In order to add an MCP server to Claude Desktop you need to edit the configuration file located at:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Example configuration:

```json
{
  "mcpServers": {
    "wordpress-mcp": {
      "command": "npx",
      "args": ["mcp-wordpress-remote-proxy"],
      "env": {
        "WP_API_URL": "https://your-wordpress-site.com",
        "WP_API_USERNAME": "your-username",
        "WP_API_PASSWORD": "your-password",
        "WOO_CUSTOMER_KEY": "your-woo-customer-key",
        "WOO_CUSTOMER_SECRET": "your-woo-customer-secret",
        "LOG_FILE": "optional full path to the log file"
      }
    }
  }
}
```

https://woocommerce.com/document/woocommerce-rest-api/

#### Cursor

The configuration file is located at `~/.cursor/mcp.json`.

Example configuration:

```json
{
  "mcpServers": {
    "wordpress-mcp": {
      "command": "npx",
      "args": ["mcp-wordpress-remote-proxy"],
      "env": {
        "WP_API_URL": "https://your-wordpress-site.com",
        "WP_API_USERNAME": "your-username",
        "WP_API_PASSWORD": "your-password",
        "WOO_CUSTOMER_KEY": "your-woo-customer-key",
        "WOO_CUSTOMER_SECRET": "your-woo-customer-secret",
        "LOG_FILE": "optional full path to the log file"
      }
    }
  }
}
```

## Development

### Building

```bash
npm run build
```

### Development Mode

```bash
npm run dev
```

### Testing

```bash
npm test
```
