# MCP WordPress Remote

The mcp-wordpress-remote package acts as a bridge between local Model Context Protocol (MCP) clients and remote WordPress MCP servers. By leveraging npx, you can execute this package without a global installation, simplifying the setup process.

## WordPress MCP plugin

You have to install the [wordpress-mcp](https://github.com/Automattic/wordpress-mcp) plugin on your WordPress website.

## Why

1. Most of the clients does not suport SSE or Streamable communications protocols.
2. Improved eficiency. This proxy will not keep an open connection to your website, and it will only make simple REST API requests to your website when needed.
3. Oauth2.1 is not yet available on wordpress out of the box.
4. Security trough WordPress API passwords and WooCommerce REST API cosumer key and secret
5. Easy to use. See installation instructions below.

## Usage

### Environment Variables

The following environment variables are required:

- `WP_API_URL`: The URL of your WordPress site (e.g., `https://example.com`)
- `WP_API_USERNAME`: Your WordPress username
- `WP_API_PASSWORD`: Your WordPress API password
- `WOO_CUSTOMER_KEY`: Your Woocommerce customer key (optional, if you intend to use WooCommerce MCP assets)
- `WOO_CUSTOMER_SECRET`: Your WooCommerce customer secret (optional, if you intend to use WooCommerce MCP assets)
- `LOG_FILE`: Optional full path to a log file

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
      "args": ["@Automattic/mcp-wordpress-remote"],
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
      "args": ["@Automattic/mcp-wordpress-remote"],
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

## @todo

As of now, this package is in its early development stages. Any suggestions, bugreports, PR's are welcome.
