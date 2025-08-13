# Testing Guide

This document provides comprehensive testing instructions for the MCP WordPress Remote package.

## Setup for Testing

### Prerequisites

1. **WordPress Test Site** with MCP plugin installed
2. **Node.js 22+** installed
3. **Test credentials** prepared for different auth methods

### Local Development Setup

```bash
# Clone and setup
git clone https://github.com/Automattic/mcp-wordpress-remote.git
cd mcp-wordpress-remote
npm install
npm run build
```

## Authentication Testing

### OAuth 2.0 Testing

#### Test Basic OAuth Flow

1. **Configure for OAuth:**

   ```json
   {
     "mcpServers": {
       "wordpress-test": {
         "command": "node",
         "args": ["/path/to/dist/proxy.js"],
         "env": {
           "WP_API_URL": "https://test-site.com",
           "OAUTH_ENABLED": "true"
         }
       }
     }
   }
   ```

2. **Start MCP client** and verify:

   - Browser opens automatically
   - Authorization page loads correctly
   - After authorization, browser shows success message
   - Client connects successfully

3. **Test token persistence:**
   - Restart MCP client
   - Should connect without browser opening
   - Check token files in `~/.mcp-auth/wordpress-remote-*/`

#### Test OAuth Port Configuration

1. **Test custom port:**

   ```json
   {
     "env": {
       "OAUTH_CALLBACK_PORT": "8080"
     }
   }
   ```

2. **Verify:**
   - Callback server starts on port 8080
   - Authorization flow works correctly

#### Test OAuth Coordination

1. **Start multiple MCP clients simultaneously**
2. **Verify:**
   - Only one browser window opens
   - Other instances wait for authentication
   - All instances connect after authorization
   - Check logs for coordination messages

### JWT Token Testing

1. **Configure JWT authentication:**

   ```json
   {
     "env": {
       "JWT_TOKEN": "your-test-jwt-token",
       "OAUTH_ENABLED": "false"
     }
   }
   ```

2. **Test scenarios:**
   - Valid JWT token connects successfully
   - Invalid JWT token shows proper error
   - Expired JWT token handles gracefully

### Basic Auth Testing

1. **Configure application password:**

   ```json
   {
     "env": {
       "WP_API_USERNAME": "testuser",
       "WP_API_PASSWORD": "test-app-password",
       "OAUTH_ENABLED": "false"
     }
   }
   ```

2. **Test scenarios:**
   - Valid credentials connect successfully
   - Invalid credentials show proper error
   - Missing credentials show configuration error

### WooCommerce Testing

1. **Configure WooCommerce credentials:**

   ```json
   {
     "env": {
       "WOO_CUSTOMER_KEY": "ck_test_key",
       "WOO_CUSTOMER_SECRET": "cs_test_secret"
     }
   }
   ```

2. **Test WooCommerce-specific tools:**
   - WooCommerce reports tools work correctly
   - Credentials are used for WC endpoints

## Multi-Instance Testing

### Test Scenarios

1. **Simultaneous startup:**

   - Start 3 MCP clients at same time
   - Verify only one OAuth flow triggers
   - Check all instances connect successfully

2. **Staggered startup:**

   - Start one client, let it authenticate
   - Start second client while first is running
   - Verify second uses existing tokens

3. **Lock timeout testing:**
   - Manually create stale lock file
   - Start MCP client
   - Verify stale lock is cleaned up

### Verification Steps

1. **Check lock files:**

   ```bash
   ls -la ~/.mcp-auth/wordpress-remote-*/*_auth.lock
   ```

2. **Monitor logs:**

   ```bash
   tail -f /path/to/logfile.log
   ```

3. **Verify coordination messages:**
   - "Acquired auth lock"
   - "Waiting for other instance"
   - "Tokens are now available from other instance"

## Error Handling Testing

### Configuration Errors

1. **Missing WP_API_URL:**

   ```json
   {
     "env": {}
   }
   ```

   Expected: Clear configuration error

2. **Invalid URL format:**

   ```json
   {
     "env": {
       "WP_API_URL": "not-a-url"
     }
   }
   ```

   Expected: URL validation error

3. **No authentication method:**
   ```json
   {
     "env": {
       "WP_API_URL": "https://test.com",
       "OAUTH_ENABLED": "false"
     }
   }
   ```
   Expected: Authentication method error

### Network Errors

1. **Unreachable WordPress site:**

   - Use non-existent domain
   - Verify proper network error handling

2. **WordPress site without MCP plugin:**

   - Use WordPress site without plugin
   - Verify 404 error handling

3. **Port conflicts:**
   - Start service on port 3000
   - Start OAuth callback server
   - Verify port conflict error

### API Errors

1. **Authentication failures:**

   - Invalid credentials
   - Expired tokens
   - Insufficient permissions

2. **API endpoint errors:**
   - Non-existent endpoints
   - Invalid parameters
   - Server errors

## Logging Testing

### Log Levels

Test each log level:

```bash
# Error only
LOG_LEVEL=0 node dist/proxy.js

# Warnings and errors
LOG_LEVEL=1 node dist/proxy.js

# Info (default)
LOG_LEVEL=2 node dist/proxy.js

# Debug (verbose)
LOG_LEVEL=3 node dist/proxy.js
```

### Log Categories

Verify logs include proper categories:

- `[AUTH]` - Authentication events
- `[OAUTH]` - OAuth flow events
- `[API]` - API requests/responses
- `[MCP]` - MCP protocol events
- `[PROXY]` - Proxy lifecycle events
- `[COORDINATION]` - Multi-instance coordination

### Log File Testing

1. **Configure log file:**

   ```json
   {
     "env": {
       "LOG_FILE": "/tmp/mcp-test.log"
     }
   }
   ```

2. **Verify:**
   - Log file is created
   - Logs written to file
   - Console logs still appear

## Performance Testing

### Token Validation Performance

1. **Measure token validation time:**

   - Monitor logs for validation timing
   - Test with multiple concurrent requests

2. **Cache effectiveness:**
   - First request (token validation)
   - Subsequent requests (cached validation)

### Startup Performance

1. **Cold start (no tokens):**

   - Time OAuth flow completion
   - Measure total startup time

2. **Warm start (existing tokens):**
   - Time token validation
   - Measure connection time

### Memory Usage

1. **Monitor memory usage:**

   ```bash
   node --expose-gc dist/proxy.js
   ```

2. **Test scenarios:**
   - Long-running process
   - Multiple OAuth flows
   - Token cleanup operations

## Browser Testing

### OAuth Browser Integration

1. **Test browsers:**

   - Chrome/Chromium
   - Firefox
   - Safari (macOS)
   - Edge (Windows)

2. **Test scenarios:**
   - Automatic browser opening
   - Manual URL opening
   - Browser security restrictions

### Headless Environment Testing

1. **Test without browser:**

   - SSH/headless server
   - CI/CD environment
   - Docker container

2. **Verify:**
   - Proper fallback messages
   - Manual URL display
   - Error handling

## Integration Testing

### MCP Client Testing

1. **Claude Desktop:**

   - Full OAuth flow
   - Tool execution
   - Resource access

2. **Other MCP clients:**
   - Test compatibility
   - Verify protocol compliance

### WordPress Plugin Integration

1. **Test MCP plugin versions:**

   - Latest plugin version
   - Compatibility testing
   - Feature availability

2. **Test WordPress versions:**
   - Latest WordPress
   - Common versions (5.9+)
   - Multisite installations

## Automated Testing

### Unit Tests

```bash
npm test
```

Test coverage includes:

- Configuration validation
- Token management
- Error handling
- Utility functions

### Integration Tests

```bash
npm run test:integration
```

Requires test WordPress site configuration.

### End-to-End Tests

```bash
npm run test:e2e
```

Full workflow testing with real WordPress site.

## Test Data Cleanup

### Remove Test Tokens

```bash
# Remove all test tokens
rm -rf ~/.mcp-auth/wordpress-remote-*/

# Remove specific test tokens
rm -rf ~/.mcp-auth/wordpress-remote-*/test-site-hash_*
```

### Reset Test Environment

```bash
# Clear logs
> /tmp/mcp-test.log

# Remove lock files
rm -f ~/.mcp-auth/wordpress-remote-*/*_auth.lock

# Clear test configuration
unset WP_API_URL WP_API_USERNAME WP_API_PASSWORD JWT_TOKEN
```

## Troubleshooting Tests

### Common Test Issues

1. **Port conflicts:**

   - Use different OAuth callback ports
   - Check for running services

2. **Token persistence:**

   - Verify file permissions
   - Check directory creation

3. **Browser automation:**
   - Test in different environments
   - Verify browser installation

### Debug Mode Testing

Enable maximum verbosity:

```json
{
  "env": {
    "LOG_LEVEL": "3",
    "LOG_FILE": "/tmp/debug.log",
    "NODE_ENV": "development"
  }
}
```

Review debug logs for:

- Authentication flow details
- Token validation steps
- API request/response data
- Coordination events

## Test Checklist

### Before Release

- [ ] All authentication methods work
- [ ] Multi-instance coordination functions
- [ ] OAuth flow completes successfully
- [ ] Token persistence works
- [ ] Error handling is comprehensive
- [ ] Logging levels function correctly
- [ ] Browser integration works
- [ ] Performance is acceptable
- [ ] Documentation is accurate
- [ ] Examples work as documented

### Manual Testing Scenarios

- [ ] Fresh installation (no existing tokens)
- [ ] Existing tokens (warm start)
- [ ] Multiple simultaneous clients
- [ ] Network interruption recovery
- [ ] Invalid configuration handling
- [ ] Port conflict resolution
- [ ] Browser unavailable scenarios
- [ ] WordPress plugin disabled
- [ ] Token expiration handling
- [ ] Cross-platform compatibility
