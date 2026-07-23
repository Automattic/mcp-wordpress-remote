/**
 * Tool-call hooks for MCP WordPress Remote.
 *
 * Lets an embedding package observe successful `tools/call` requests and
 * piggyback on the proxy's live, authenticated session — for example to send
 * usage telemetry — without forking the proxy.
 *
 * The registry lives on a global symbol so it is a single instance even when a
 * consumer registers through the `/lib` bundle while the handlers run in the
 * separate `proxy` bundle.
 */

import { logger } from './utils.js';
import type { WordPressResponse } from './types.js';
import type { WPRequestParams } from './mcp-types.js';

/** Context passed to each hook after a tool call completes. */
export interface ToolCallContext {
  /** Name of the tool the client just called. */
  name: string;
  /**
   * Dispatch an additional request over the proxy's live, authenticated
   * session. The request is prepared for the session's detected transport
   * (JSON-RPC envelope or simple format) before it is sent, e.g.
   * `wpRequest({ method: 'tools/call', name, arguments })`.
   */
  wpRequest: (params: WPRequestParams) => Promise<WordPressResponse>;
}

/** A hook fired after each successful `tools/call`. May be async. */
export type ToolCallHook = (context: ToolCallContext) => void | Promise<void>;

const REGISTRY_KEY = Symbol.for('@automattic/mcp-wordpress-remote:tool-call-hooks');

function getRegistry(): Set<ToolCallHook> {
  const globalObject = globalThis as Record<PropertyKey, unknown>;
  let registry = globalObject[REGISTRY_KEY] as Set<ToolCallHook> | undefined;
  if (!registry) {
    registry = new Set<ToolCallHook>();
    globalObject[REGISTRY_KEY] = registry;
  }
  return registry;
}

/**
 * Register a hook fired after each successful `tools/call`. Returns a function
 * that unregisters it.
 */
export function registerToolCallHook(hook: ToolCallHook): () => void {
  const registry = getRegistry();
  registry.add(hook);
  return () => {
    registry.delete(hook);
  };
}

/**
 * Invoke all registered hooks. Best-effort: a hook that throws synchronously
 * or returns a rejecting promise is isolated so it can never break the tool
 * call it rode in on. Failures are logged so a broken hook stays diagnosable.
 */
export function runToolCallHooks(context: ToolCallContext): void {
  // Iterate a snapshot: a hook that unregisters and re-registers itself would
  // be appended to the live Set and revisited in the same pass, forever.
  const hooks = [...getRegistry()];

  // Invoke hooks on the next event-loop turn. Calling `hook(context)` inside
  // Promise.resolve still runs all synchronous (and pre-first-await) work on
  // the tool-call response path, so a slow hook could delay the client.
  setImmediate(() => {
    for (const hook of hooks) {
      try {
        Promise.resolve(hook(context)).catch(error => {
          logHookFailure(error);
        });
      } catch (error) {
        logHookFailure(error);
      }
    }
  });
}

/** A hook must never break the request path — log the failure and move on. */
function logHookFailure(error: unknown): void {
  try {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Tool-call hook failed: ${message}`, 'HOOKS');
  } catch {
    // Logging can itself fail (for example, an unwritable LOG_FILE). Hook
    // diagnostics remain best-effort and must never reopen the failure path.
  }
}
