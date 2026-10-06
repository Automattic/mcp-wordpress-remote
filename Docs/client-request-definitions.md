# Forwarded MCP messages

The proxy forwards generic JSON-RPC messages and does not maintain a method allowlist. The methods below are examples from initialization-based MCP revisions; the configured endpoint owns which methods and capabilities are available. Client notifications, server-initiated requests, and client replies are forwarded as well. Metadata-based revisions can start with `server/discover` or another request carrying per-request metadata.

## Core Protocol Methods:

- initialize
- ping

## Prompt-related Methods:

- prompts/list
- prompts/get

## Resource-related Methods:

- resources/templates/list
- resources/list
- resources/read
- resources/subscribe
- resources/unsubscribe

## Root-related Methods:

- roots/list

## Tool-related Methods:

- tools/call
- tools/list

## Logging Methods:

- logging/setLevel

## Completion Methods:

- completion/complete

## Notification Methods:

- notifications/initialized
- notifications/cancelled
- notifications/progress
- notifications/roots/list_changed
