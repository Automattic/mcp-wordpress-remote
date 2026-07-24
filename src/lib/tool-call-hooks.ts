/**
 * Tool-call hooks for MCP WordPress Remote.
 *
 * Lets an embedding package observe completed `tools/call` requests and
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

/** A hook fired after each completed `tools/call`. May be async. */
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
 * Register a hook fired after each completed `tools/call`. Returns a function
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
 * Invoke all registered hooks after the request path has completed. A hook can
 * never alter the tool call it rode in on: it runs on a later tick and its
 * failures are isolated and logged rather than propagated.
 */
export function runToolCallHooks(context: ToolCallContext): void {
  // Snapshot the registry: a hook that unregisters and re-registers itself
  // would otherwise be revisited forever within this same pass.
  const hooks = [...getRegistry()];
  if (hooks.length === 0) return;

  setImmediate(() => {
    for (const hook of hooks) {
      void Promise.resolve()
        .then(() => hook(context))
        .catch(error => {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(`Tool-call hook failed: ${message}`, 'HOOKS');
        })
        // Logging can itself fail (e.g. an unwritable LOG_FILE); never let that
        // reopen the failure path as an unhandled rejection.
        .catch(() => {});
    }
  });
}
