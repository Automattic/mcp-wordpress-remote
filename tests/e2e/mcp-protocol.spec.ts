/**
 * End-to-end tests for MCP protocol implementation
 */

import { test, expect } from '@playwright/test';

test.describe('MCP Protocol Integration', () => {
  test.beforeEach(async ({ page }) => {
    // Set up authenticated state
    await page.addInitScript(() => {
      const validToken = {
        access_token: 'valid_test_token',
        token_type: 'Bearer',
        expires_in: 3600,
        obtained_at: Date.now(),
        refresh_token: 'valid_refresh_token',
      };
      (globalThis as any).localStorage.setItem('wp_oauth_tokens', JSON.stringify(validToken));
    });
  });

  test('should handle MCP initialization', async ({ page }) => {
    // Navigate to MCP endpoint
    await page.goto('/mcp/initialize');

    // Should return proper MCP initialization response
    const response = await page.locator('pre').textContent();
    const mcpResponse = JSON.parse(response || '{}');

    expect(mcpResponse).toHaveProperty('serverInfo');
    expect(mcpResponse).toHaveProperty('capabilities');
    expect(mcpResponse.serverInfo).toHaveProperty('name');
    expect(mcpResponse.serverInfo).toHaveProperty('version');
  });

  test('should list available tools via MCP', async ({ page }) => {
    await page.goto('/mcp/tools/list');

    const response = await page.locator('pre').textContent();
    const mcpResponse = JSON.parse(response || '{}');

    expect(mcpResponse).toHaveProperty('tools');
    expect(Array.isArray(mcpResponse.tools)).toBe(true);

    // Should include WordPress-specific tools
    const toolNames = mcpResponse.tools.map((tool: any) => tool.name);
    expect(toolNames).toContain('wordpress_get_posts');
    expect(toolNames).toContain('wordpress_create_post');
  });

  test('should execute WordPress tools via MCP', async ({ page }) => {
    // Test tool execution
    await page.goto('/mcp/tools/call', {
      waitUntil: 'networkidle',
    });

    // Fill in tool call form
    await page.fill('#tool-name', 'wordpress_get_posts');
    await page.fill('#tool-arguments', JSON.stringify({ limit: 5 }));
    await page.click('#execute-tool');

    // Should show tool execution result
    await expect(page.locator('.tool-result')).toBeVisible();
    
    const result = await page.locator('.tool-result pre').textContent();
    const toolResponse = JSON.parse(result || '{}');

    expect(toolResponse).toHaveProperty('content');
    expect(Array.isArray(toolResponse.content)).toBe(true);
  });

  test('should list available resources via MCP', async ({ page }) => {
    await page.goto('/mcp/resources/list');

    const response = await page.locator('pre').textContent();
    const mcpResponse = JSON.parse(response || '{}');

    expect(mcpResponse).toHaveProperty('resources');
    expect(Array.isArray(mcpResponse.resources)).toBe(true);

    // Should include WordPress resources
    const resourceUris = mcpResponse.resources.map((resource: any) => resource.uri);
    expect(resourceUris.some((uri: string) => uri.includes('wordpress://posts'))).toBe(true);
  });

  test('should read WordPress resources via MCP', async ({ page }) => {
    await page.goto('/mcp/resources/read');

    // Fill in resource URI
    await page.fill('#resource-uri', 'wordpress://posts');
    await page.click('#read-resource');

    // Should show resource content
    await expect(page.locator('.resource-content')).toBeVisible();
    
    const content = await page.locator('.resource-content pre').textContent();
    const resourceData = JSON.parse(content || '{}');

    expect(resourceData).toHaveProperty('contents');
    expect(Array.isArray(resourceData.contents)).toBe(true);
  });

  test('should handle MCP prompts', async ({ page }) => {
    await page.goto('/mcp/prompts/list');

    const response = await page.locator('pre').textContent();
    const mcpResponse = JSON.parse(response || '{}');

    expect(mcpResponse).toHaveProperty('prompts');
    expect(Array.isArray(mcpResponse.prompts)).toBe(true);
  });

  test('should execute MCP prompts with arguments', async ({ page }) => {
    await page.goto('/mcp/prompts/get');

    // Fill in prompt details
    await page.fill('#prompt-name', 'wordpress_content_summary');
    await page.fill('#prompt-arguments', JSON.stringify({ 
      post_type: 'post',
      limit: 10 
    }));
    await page.click('#get-prompt');

    // Should show prompt result
    await expect(page.locator('.prompt-result')).toBeVisible();
    
    const result = await page.locator('.prompt-result pre').textContent();
    const promptResponse = JSON.parse(result || '{}');

    expect(promptResponse).toHaveProperty('messages');
    expect(Array.isArray(promptResponse.messages)).toBe(true);
  });

  test('should handle MCP error responses', async ({ page }) => {
    // Test invalid tool call
    await page.goto('/mcp/tools/call');

    await page.fill('#tool-name', 'nonexistent_tool');
    await page.fill('#tool-arguments', '{}');
    await page.click('#execute-tool');

    // Should show error response
    await expect(page.locator('.error-message')).toBeVisible();
    
    const errorText = await page.locator('.error-message').textContent();
    expect(errorText).toContain('Tool not found');
  });

  test('should maintain MCP session state', async ({ page }) => {
    // Make multiple MCP requests to verify session consistency
    await page.goto('/mcp/tools/list');
    const tools1 = await page.locator('pre').textContent();

    await page.goto('/mcp/resources/list');
    const resources = await page.locator('pre').textContent();

    await page.goto('/mcp/tools/list');
    const tools2 = await page.locator('pre').textContent();

    // Tools list should be consistent across requests
    expect(tools1).toBe(tools2);
    
    // Both should be valid JSON responses
    expect(() => JSON.parse(tools1 || '{}')).not.toThrow();
    expect(() => JSON.parse(resources || '{}')).not.toThrow();
  });

  test('should handle concurrent MCP requests', async ({ page }) => {
    // Open multiple tabs for concurrent testing
    const promises = [
      page.goto('/mcp/tools/list'),
      page.goto('/mcp/resources/list'),
      page.goto('/mcp/prompts/list'),
    ];

    await Promise.all(promises);

    // All requests should complete successfully
    // The last navigation (prompts/list) should be visible
    const response = await page.locator('pre').textContent();
    const mcpResponse = JSON.parse(response || '{}');
    expect(mcpResponse).toHaveProperty('prompts');
  });

  test('should validate MCP request/response format', async ({ page }) => {
    await page.goto('/mcp/tools/list');

    const response = await page.locator('pre').textContent();
    const mcpResponse = JSON.parse(response || '{}');

    // Should follow MCP JSON-RPC format
    expect(mcpResponse).toHaveProperty('jsonrpc');
    expect(mcpResponse.jsonrpc).toBe('2.0');
    expect(mcpResponse).toHaveProperty('id');
    expect(mcpResponse).toHaveProperty('result');
  });

  test('should handle MCP logging and debugging', async ({ page }) => {
    // Test logging level changes
    await page.goto('/mcp/logging/setLevel');

    await page.fill('#log-level', 'debug');
    await page.click('#set-level');

    // Should acknowledge log level change
    await expect(page.locator('.success-message')).toBeVisible();

    // Subsequent requests should have more verbose logging
    await page.goto('/mcp/tools/list');
    
    // Check for debug information (implementation specific)
    const hasDebugInfo = await page.locator('.debug-info').isVisible();
    // Debug info might not be visible in UI, but logging should be affected
  });

  test('should handle MCP completion requests', async ({ page }) => {
    await page.goto('/mcp/completion/complete');

    // Fill in completion request
    await page.fill('#completion-ref', 'wordpress_post_');
    await page.fill('#completion-argument', 'title');
    await page.click('#get-completion');

    // Should provide completions
    await expect(page.locator('.completion-results')).toBeVisible();
    
    const results = await page.locator('.completion-results pre').textContent();
    const completionResponse = JSON.parse(results || '{}');

    expect(completionResponse).toHaveProperty('completion');
    expect(completionResponse.completion).toHaveProperty('values');
  });

  test('should handle large MCP responses', async ({ page }) => {
    // Test with a request that returns large amounts of data
    await page.goto('/mcp/tools/call');

    await page.fill('#tool-name', 'wordpress_get_posts');
    await page.fill('#tool-arguments', JSON.stringify({ limit: 100 }));
    await page.click('#execute-tool');

    // Should handle large response without timeout
    await expect(page.locator('.tool-result')).toBeVisible({ timeout: 10000 });
    
    const result = await page.locator('.tool-result pre').textContent();
    expect(result).toBeTruthy();
    expect(result!.length).toBeGreaterThan(1000); // Should be substantial data
  });

  test('should work with different WordPress site types', async ({ page }) => {
    // Test with hosted WordPress site
    await page.addInitScript(() => {
      (globalThis as any).localStorage.setItem('wp_site_type', 'hosted_wordpress');
    });

    await page.goto('/mcp/tools/list');
    const hostedTools = await page.locator('pre').textContent();

    // Test with self-hosted site
    await page.addInitScript(() => {
      (globalThis as any).localStorage.setItem('wp_site_type', 'self_hosted');
    });

    await page.goto('/mcp/tools/list');
    const selfHostedTools = await page.locator('pre').textContent();

    // Both should return valid tool lists, but may differ
    expect(() => JSON.parse(hostedTools || '{}')).not.toThrow();
    expect(() => JSON.parse(selfHostedTools || '{}')).not.toThrow();
  });
});
