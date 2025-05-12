## Testing the proxy

```json
{
  "mcpServers": {
    "wordpress-mcp": {
      "command": "node",
      "args": ["dist/proxy.js"],
      "env": {
        "WORDPRESS_API_URL": "https://your-wordpress-site.com",
        "WP_API_USERNAME": "your-username",
        "WP_API_PASSWORD": "your-application-password",
        "WOO_CUSTOMER_KEY": "your-woo-customer-key",
        "WOO_CUSTOMER_SECRET": "your-woo-customer-secret",
        "LOG_FILE": "optional full path to the log file",
        "LOG_DIR": "optional directory for log files"
      }
    }
  }
}
```
