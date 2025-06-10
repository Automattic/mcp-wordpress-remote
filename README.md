# MCP WordPress Remote

The mcp-wordpress-remote package acts as a bridge between local Model Context Protocol (MCP) clients and remote WordPress MCP servers. By leveraging npx, you can execute this package without a global installation, simplifying the setup process.

## Requirements

- Node.js version 22 or higher

## WordPress MCP plugin

You have to install the [wordpress-mcp](https://github.com/Automattic/wordpress-mcp) plugin on your WordPress website, and enable MCP Functionality on Settings > MCP Settings.

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
- `WP_API_PASSWORD`: Your WordPress [application password](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/#Getting-Credentials)
- `WOO_CUSTOMER_KEY`: Your Woocommerce customer key (optional, if you intend to use WooCommerce MCP assets)
- `WOO_CUSTOMER_SECRET`: Your WooCommerce customer secret (optional, if you intend to use WooCommerce MCP assets)
- `LOG_FILE`: Optional full path to a log file

### Configuration in MCP Clients

Please check [WordPress-mcp](https://github.com/Automattic/wordpress-mcp?tab=readme-ov-file#mcp-client-configuration) plugin git repository for configuration details

## @todo

As of now, this package is in its early development stages. Any suggestions, bugreports, PR's are welcome.
