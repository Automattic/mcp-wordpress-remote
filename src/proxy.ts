#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { InitializeResult } from './lib/schema/2024-11-05/schema.js';
import { wpRequest } from './lib/wordpress-api.js';
import { log } from './lib/utils.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ServerCapabilitiesSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  SetLevelRequestSchema,
  CompleteRequestSchema,
  ListRootsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

// Define request types
type ListToolsRequest = z.infer<typeof ListToolsRequestSchema>;
type CallToolRequest = z.infer<typeof CallToolRequestSchema>;
type ListResourcesRequest = z.infer<typeof ListResourcesRequestSchema>;
type ListResourceTemplatesRequest = z.infer<typeof ListResourceTemplatesRequestSchema>;
type ReadResourceRequest = z.infer<typeof ReadResourceRequestSchema>;
type SubscribeRequest = z.infer<typeof SubscribeRequestSchema>;
type UnsubscribeRequest = z.infer<typeof UnsubscribeRequestSchema>;
type ListPromptsRequest = z.infer<typeof ListPromptsRequestSchema>;
type GetPromptRequest = z.infer<typeof GetPromptRequestSchema>;
type SetLevelRequest = z.infer<typeof SetLevelRequestSchema>;
type CompleteRequest = z.infer<typeof CompleteRequestSchema>;
type ListRootsRequest = z.infer<typeof ListRootsRequestSchema>;

async function WordPressProxy() {
  const init = (await wpRequest({ method: 'init' })) as InitializeResult;

  const server = new Server(
    {
      name: init.serverInfo.name,
      version: init.serverInfo.version,
    },
    {
      capabilities: init.capabilities as any, // Type assertion to fix linter error
    }
  );

  const withLogging = (schema: string, handler: Function) => async (request: any) => {
    log(`Received ${schema} request:`, JSON.stringify(request));
    const response = await handler(request);
    log(`${schema} response:`, JSON.stringify(response));
    return response;
  };

  // List Tools Handler
  server.setRequestHandler(
    ListToolsRequestSchema,
    withLogging('ListTools', async (request: ListToolsRequest) => {
      log('Processing ListToolsRequest');
      const response = await wpRequest({
        method: 'tools/list',
        cursor: request.params?.cursor,
      });
      return response;
    })
  );

  // Call Tool Handler
  server.setRequestHandler(
    CallToolRequestSchema,
    withLogging('CallTool', async (request: CallToolRequest) => {
      log('Processing CallToolRequest');
      const response = await wpRequest({
        method: 'tools/call',
        name: request.params.name,
        arguments: request.params.arguments,
      });
      return response;
    })
  );

  // List Resources Handler
  server.setRequestHandler(
    ListResourcesRequestSchema,
    withLogging('ListResources', async (request: ListResourcesRequest) => {
      log('Processing ListResourcesRequest');
      const response = await wpRequest({
        method: 'resources/list',
        cursor: request.params?.cursor,
      });
      return response;
    })
  );

  // List Resource Templates Handler
  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    withLogging('ListResourceTemplates', async (request: ListResourceTemplatesRequest) => {
      log('Processing ListResourceTemplatesRequest');
      const response = await wpRequest({
        method: 'resources/templates/list',
        cursor: request.params?.cursor,
      });
      return response;
    })
  );

  // Read Resource Handler
  server.setRequestHandler(
    ReadResourceRequestSchema,
    withLogging('ReadResource', async (request: ReadResourceRequest) => {
      log('Processing ReadResourceRequest');
      const response = await wpRequest({
        method: 'resources/read',
        uri: request.params.uri,
      });
      return response;
    })
  );

  // Subscribe Handler
  server.setRequestHandler(
    SubscribeRequestSchema,
    withLogging('Subscribe', async (request: SubscribeRequest) => {
      log('Processing SubscribeRequest');
      const response = await wpRequest({
        method: 'resources/subscribe',
        uri: request.params.uri,
      });
      return response;
    })
  );

  // Unsubscribe Handler
  server.setRequestHandler(
    UnsubscribeRequestSchema,
    withLogging('Unsubscribe', async (request: UnsubscribeRequest) => {
      log('Processing UnsubscribeRequest');
      const response = await wpRequest({
        method: 'resources/unsubscribe',
        uri: request.params.uri,
      });
      return response;
    })
  );

  // List Prompts Handler
  server.setRequestHandler(
    ListPromptsRequestSchema,
    withLogging('ListPrompts', async (request: ListPromptsRequest) => {
      log('Processing ListPromptsRequest');
      const response = await wpRequest({
        method: 'prompts/list',
        cursor: request.params?.cursor,
      });
      return response;
    })
  );

  // Get Prompt Handler
  server.setRequestHandler(
    GetPromptRequestSchema,
    withLogging('GetPrompt', async (request: GetPromptRequest) => {
      log('Processing GetPromptRequest');
      const response = await wpRequest({
        method: 'prompts/get',
        name: request.params.name,
        arguments: request.params.arguments,
      });
      return response;
    })
  );

  // Set Logging Level Handler
  server.setRequestHandler(
    SetLevelRequestSchema,
    withLogging('SetLevel', async (request: SetLevelRequest) => {
      log('Processing SetLevelRequest');
      const response = await wpRequest({
        method: 'logging/setLevel',
        level: request.params.level,
      });
      return response;
    })
  );

  // Complete Handler
  server.setRequestHandler(
    CompleteRequestSchema,
    withLogging('Complete', async (request: CompleteRequest) => {
      log('Processing CompleteRequest');
      const response = await wpRequest({
        method: 'completion/complete',
        ref: request.params.ref,
        argument: request.params.argument,
      });
      return response;
    })
  );

  // List Roots Handler
  server.setRequestHandler(
    ListRootsRequestSchema,
    withLogging('ListRoots', async (request: ListRootsRequest) => {
      log('Processing ListRootsRequest');
      const response = await wpRequest({
        method: 'roots/list',
      });
      return response;
    })
  );

  const transport = new StdioServerTransport();
  // Connect to the transport
  server
    .connect(transport)
    .then(() => {
      log('MCP server connected to transport successfully');
    })
    .catch(error => {
      log(`Error starting MCP server:`, error);
      process.exit(1);
    });
}

WordPressProxy();
