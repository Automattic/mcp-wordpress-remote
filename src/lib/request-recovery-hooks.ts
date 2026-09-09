/**
 * Opt-in request recovery hooks for embedding packages.
 *
 * The base proxy does not decide which application responses are safe to
 * retry. An embedding package can inspect the first outcome, perform its own
 * recovery action, and return true to request one retry.
 *
 * The registry uses a global symbol so registrations made through the `/lib`
 * bundle are visible to the separately bundled proxy entry point.
 */

import { logger } from './utils.js';
import type { APIError } from './oauth-types.js';
import type { WordPressResponse } from './types.js';

export interface RequestRecoveryContext {
  /** WordPress/MCP method from the original request. */
  method: string;
  /** Refresh the proxy state used by the request path invoking this hook. */
  refreshProxy: () => Promise<void>;
  /** First successful transport response, when the request did not throw. */
  response?: WordPressResponse;
  /** First API failure, when the request did throw. */
  error?: APIError;
}

/**
 * Return true after completing recovery to request one retry. Hook failures
 * are isolated so an optional policy cannot replace the original outcome.
 */
export type RequestRecoveryHook = (context: RequestRecoveryContext) => boolean | Promise<boolean>;

const REGISTRY_KEY = Symbol.for('@automattic/mcp-wordpress-remote:request-recovery-hooks');

function getRegistry(): Set<RequestRecoveryHook> {
  const globalObject = globalThis as Record<PropertyKey, unknown>;
  let registry = globalObject[REGISTRY_KEY] as Set<RequestRecoveryHook> | undefined;
  if (!registry) {
    registry = new Set<RequestRecoveryHook>();
    globalObject[REGISTRY_KEY] = registry;
  }
  return registry;
}

/** Register an opt-in recovery policy and return its unregister function. */
export function registerRequestRecoveryHook(hook: RequestRecoveryHook): () => void {
  const registry = getRegistry();
  registry.add(hook);
  return () => {
    registry.delete(hook);
  };
}

/**
 * Ask registered policies whether the first request outcome should be retried.
 * The caller owns the one-retry limit; this function only evaluates policies.
 */
export async function runRequestRecoveryHooks(context: RequestRecoveryContext): Promise<boolean> {
  const hooks = [...getRegistry()];

  for (const hook of hooks) {
    try {
      if (await hook(context)) {
        return true;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Request-recovery hook failed: ${message}`, 'HOOKS');
    }
  }

  return false;
}
