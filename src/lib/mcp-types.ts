/**
 * MCP Request Types for WordPress Remote Proxy
 * 
 * Type definitions for all MCP JSON-RPC request schemas
 */

import { z } from 'zod';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
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

// MCP Request Types
export type ListToolsRequest = z.infer<typeof ListToolsRequestSchema>;
export type CallToolRequest = z.infer<typeof CallToolRequestSchema>;
export type ListResourcesRequest = z.infer<typeof ListResourcesRequestSchema>;
export type ListResourceTemplatesRequest = z.infer<typeof ListResourceTemplatesRequestSchema>;
export type ReadResourceRequest = z.infer<typeof ReadResourceRequestSchema>;
export type SubscribeRequest = z.infer<typeof SubscribeRequestSchema>;
export type UnsubscribeRequest = z.infer<typeof UnsubscribeRequestSchema>;
export type ListPromptsRequest = z.infer<typeof ListPromptsRequestSchema>;
export type GetPromptRequest = z.infer<typeof GetPromptRequestSchema>;
export type SetLevelRequest = z.infer<typeof SetLevelRequestSchema>;
export type CompleteRequest = z.infer<typeof CompleteRequestSchema>;
export type ListRootsRequest = z.infer<typeof ListRootsRequestSchema>;

// Request Schema exports for convenience
export {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  SetLevelRequestSchema,
  CompleteRequestSchema,
  ListRootsRequestSchema,
};

// Common interfaces used across the proxy
export interface WPRequestParams {
  method: string;
  [key: string]: unknown;
}

export interface MCPRequest {
  id?: string | number;
  [key: string]: unknown;
}

export type TransportType = 'jsonrpc' | 'simple' | null;
