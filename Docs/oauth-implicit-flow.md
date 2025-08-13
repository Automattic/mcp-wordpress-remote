# OAuth Implicit Flow Support

This document explains how to use the OAuth implicit flow with the MCP WordPress Remote server. While the implicit flow is considered legacy and less secure than the authorization code flow, it's still supported for compatibility with certain WordPress sites and legacy implementations.

## When to Use Implicit Flow

The implicit flow is appropriate in these scenarios:

1. **WordPress.com hosted sites** - WordPress.com's OAuth implementation works best with implicit flow
2. **Legacy WordPress OAuth plugins** - Some older OAuth plugins only support implicit flow
3. **Client-side applications** - When you can't securely store a client secret
4. **Testing and development** - When you need a simpler OAuth setup for testing

## Security Considerations

⚠️ **Important**: The implicit flow has known security limitations:

- Access tokens are exposed in the browser URL
- No refresh tokens are provided
- Tokens cannot be securely validated
- More vulnerable to token theft

For production applications with self-hosted WordPress sites, we recommend using the authorization code flow with PKCE instead.

## Configuration

To enable implicit flow, set these environment variables:

```bash
# Enable OAuth
OAUTH_ENABLED=true

# Set flow type to implicit
OAUTH_FLOW_TYPE=implicit

# Disable PKCE (not used in implicit flow)
OAUTH_USE_PKCE=false

# Your WordPress site URL
WP_API_URL=https://yoursite.wordpress.com

# OAuth client ID from your WordPress site
WP_OAUTH_CLIENT_ID=your_client_id

# Callback server settings
OAUTH_CALLBACK_PORT=3000
OAUTH_HOST=127.0.0.1
```

## WordPress.com Setup

For WordPress.com sites, the system automatically detects and recommends implicit flow:

1. **Register your application** at https://developer.wordpress.com/apps/
2. **Set the redirect URI** to `http://127.0.0.1:3000/oauth/callback`
3. **Copy the Client ID** to your `WP_OAUTH_CLIENT_ID` environment variable
4. **Set the flow type** to implicit (or let it auto-detect)

Example configuration for WordPress.com:

```bash
OAUTH_ENABLED=true
OAUTH_FLOW_TYPE=implicit
WP_API_URL=https://yoursite.wordpress.com
WP_OAUTH_CLIENT_ID=12345
OAUTH_CALLBACK_PORT=3000
```

## Self-Hosted WordPress Setup

For self-hosted WordPress sites using plugins that only support implicit flow:

1. **Install an OAuth plugin** like WP OAuth Server or similar
2. **Configure the plugin** to support implicit flow
3. **Create a client application** in the plugin settings
4. **Set the redirect URI** to `http://127.0.0.1:3000/oauth/callback`
5. **Configure the environment variables** as shown above

## How It Works

The implicit flow follows this process:

1. **Authorization Request**: User is redirected to WordPress OAuth authorization page
2. **User Authorization**: User grants permission to your application
3. **Token Response**: WordPress redirects back with access token in URL fragment
4. **Token Extraction**: JavaScript extracts the token and sends it to the callback server
5. **Token Storage**: The server stores the token for API requests

## Troubleshooting

### Common Issues

**"No access token received"**
- Check that your OAuth client is configured correctly
- Verify the redirect URI matches exactly
- Ensure the WordPress site supports implicit flow

**"Client ID not found"**
- Verify `WP_OAUTH_CLIENT_ID` is set correctly
- Check that the client exists in your WordPress OAuth settings

**"Authorization failed"**
- Check that the user has permission to authorize applications
- Verify the OAuth plugin is active and configured
- Check WordPress error logs for detailed error messages

### Debug Mode

Enable debug logging to troubleshoot issues:

```bash
NODE_ENV=development
```

This will provide detailed logs of the OAuth flow process.

## Migration to Authorization Code Flow

For better security, consider migrating to authorization code flow:

1. **Update your WordPress OAuth plugin** to support OAuth 2.1
2. **Change the flow type**:
   ```bash
   OAUTH_FLOW_TYPE=authorization_code
   OAUTH_USE_PKCE=true
   ```
3. **Test the new flow** thoroughly
4. **Update your application** to handle refresh tokens if needed

## API Reference

When using implicit flow, tokens are shorter-lived and don't include refresh tokens:

```javascript
// Token response structure for implicit flow
{
  "access_token": "your_access_token",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "read write"
  // Note: No refresh_token in implicit flow
}
```

## Support

If you encounter issues with implicit flow:

1. Check the troubleshooting section above
2. Review the WordPress OAuth plugin documentation
3. Check WordPress and server logs for error details
4. Consider switching to authorization code flow for better security
