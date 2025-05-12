# Development Documentation

ℹ️ If you don't need to modify the proxy, you can use it directly in your client using the npx command. See the README.md file for installation and setup instructions.

## Development Setup

1. Install dependencies:

```bash
npm install
```

3. Update your MCP configuration to use the development setup:

```json
{
  "mcpServers": {
    "wordpress-mcp-server-name": {
      "command": "node",
      "args": ["/full-path-to-mcp-wordpress-remote/dist/proxy.js"],
      "env": {
        "WP_API_USERNAME": "your-wordpress-username",
        "WP_API_PASSWORD": "your application password",
        "WOO_CUSTOMER_KEY": "",
        "WOO_CUSTOMER_SECRET": "",
        "LOG_FILE": "optional full path to the log file",
        "WP_API_URL": "http(s)://your-website-url.com/"
      }
    }
  }
}
```

## Development Workflow

### Available Scripts

- `npm run build` - Build the project
- `npm run build:watch` - Watch for changes and rebuild automatically
- `npm run start` - Same as above
- `npm run check` - Run type checking and linting
- `npm run test` - Run tests
- `npm run test:watch` - Run tests in watch mode

### Development Tips

1. Use `npm run start` during development for automatic rebuilding
2. Check the logs in the specified `LOG_FILE` for debugging
3. Use `npm run check` before committing to ensure code quality

## Environment Variables

| Variable            | Description                    | Required |
| ------------------- | ------------------------------ | -------- |
| WP_API_USERNAME     | WordPress username             | Yes      |
| WP_API_PASSWORD     | WordPress application password | Yes      |
| WOO_CUSTOMER_KEY    | WooCommerce customer key       | No       |
| WOO_CUSTOMER_SECRET | WooCommerce customer secret    | No       |
| WP_API_URL          | WordPress site URL             | Yes      |
| LOG_FILE            | Path to log file               | No       |

## Troubleshooting

1. If you encounter build errors:

   - Run `npm run check` to identify issues
   - Clear the `dist` directory and rebuild
   - Check TypeScript errors in your IDE

2. If the proxy isn't connecting:

   - Verify your environment variables
   - Check the log file for errors
   - Ensure your WordPress site is accessible
   - Verify your application password is correct

3. After making changes:
   - The development proxy will automatically rebuild
   - You need to restart the MCP client for changes to take effect
