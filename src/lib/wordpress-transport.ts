import { Readable } from 'node:stream';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { JSONRPCMessage, JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CONFIG } from './config.js';
import { proxyFetch } from './fetch-utils.js';
import { getRequestUrl, getWordPressHeaders } from './wordpress-api.js';
import { APIError } from './oauth-types.js';
import { extractNetworkErrorCode, extractNetworkErrorMessage } from './error-utils.js';

/** Request `_meta` key that carries the protocol version on 2026 stateless requests. */
export const PROTOCOL_VERSION_META = 'io.modelcontextprotocol/protocolVersion';
/** Request `_meta` key that identifies the client on 2026 stateless requests. */
export const CLIENT_INFO_META = 'io.modelcontextprotocol/clientInfo';

/** Methods whose 2026 HTTP requests carry an `Mcp-Name` header. */
const NAMED_METHODS = new Set(['tools/call', 'resources/read', 'prompts/get']);

/** A tool argument that a 2026 server asks to be mirrored into an `Mcp-Param-*` header. */
interface HeaderParam {
  header: string;
  path: string[];
}

export type WordPressTransport = StreamableHTTPClientTransport & {
  /** Abandon an in-flight request by closing its response stream (2026 HTTP cancellation). */
  cancelRequest(id: string | number): void;
  /** Learn `x-mcp-header` annotations from a `tools/list` result. */
  rememberTools(tools: unknown[]): void;
};

/** Encode a header value, using the Base64 sentinel when it is not plain, trimmed ASCII. */
function headerValue(value: string): string {
  const safe =
    /^[\x20-\x7e]*$/.test(value) && value.trim() === value && !/^=\?base64\?.*\?=$/.test(value);
  return safe ? value : `=?base64?${Buffer.from(value).toString('base64')}?=`;
}

/** Collect annotations reachable from the schema root through `properties` keys only. */
function collectHeaderParams(schema: unknown, path: string[] = []): HeaderParam[] {
  const properties = (schema as { properties?: unknown } | null)?.properties;
  if (!properties || typeof properties !== 'object') return [];
  return Object.entries(properties).flatMap(([key, child]) => {
    const name = (child as Record<string, unknown> | null)?.['x-mcp-header'];
    const own =
      typeof name === 'string' ? [{ header: `Mcp-Param-${name}`, path: [...path, key] }] : [];
    return [...own, ...collectHeaderParams(child, [...path, key])];
  });
}

function valueAtPath(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>(
    (node, key) =>
      node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined,
    value
  );
}

/** Keep auth and HTTP framing outside the messages being forwarded. */
export function createWordPressTransport(
  onFailure: (message: JSONRPCMessage | undefined, error: Error) => void
): WordPressTransport {
  const inflight = new Map<string | number, () => void>();
  const toolHeaders = new Map<string, HeaderParam[]>();
  const fetch: FetchLike = async (url, init) => {
    const message: JSONRPCMessage | undefined =
      typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const request = message && 'method' in message && 'id' in message ? message : undefined;
    const controller = new AbortController();
    const abort = () => controller.abort();
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      abort();
    };
    if (request) inflight.set(request.id, cancel);
    init?.signal?.addEventListener('abort', abort, { once: true });
    if (init?.signal?.aborted) abort();
    const timeoutMs =
      message && 'method' in message && message.method === 'initialize'
        ? CONFIG.WP_API_INIT_TIMEOUT
        : CONFIG.WP_API_TIMEOUT;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      clearTimeout(timer);
      init?.signal?.removeEventListener('abort', abort);
      if (request && inflight.get(request.id) === cancel) inflight.delete(request.id);
    };
    const failure = (error: unknown): APIError => {
      cleanup();
      const apiError =
        error instanceof APIError
          ? error
          : new APIError(
              timedOut
                ? `WordPress API request timed out after ${timeoutMs}ms`
                : extractNetworkErrorMessage(error),
              0,
              String(url),
              undefined,
              timedOut ? 'ETIMEDOUT' : extractNetworkErrorCode(error)
            );
      onFailure(message, apiError);
      return apiError;
    };

    try {
      const headers = new Headers(await getWordPressHeaders(message));
      // Start the deadline after authentication: an interactive OAuth login must not
      // count against it. The GET stream and subscriptions/listen are long-lived by design.
      if (init?.method !== 'GET' && request?.method !== 'subscriptions/listen') {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
      }
      // The transport owns session/framing headers; configuration cannot replace them.
      new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
      const params = message && 'params' in message ? message.params : undefined;
      const metadataVersion = params?._meta?.[PROTOCOL_VERSION_META];
      const version =
        metadataVersion ??
        (message && 'method' in message && message.method === 'initialize'
          ? params?.protocolVersion
          : undefined);
      if (typeof version === 'string') headers.set('MCP-Protocol-Version', version);
      if (typeof metadataVersion === 'string' && message && 'method' in message) {
        headers.set('Mcp-Method', message.method);
        const name = message.method === 'resources/read' ? params?.uri : params?.name;
        if (NAMED_METHODS.has(message.method) && typeof name === 'string') {
          headers.set('Mcp-Name', headerValue(name));
        }
        if (message.method === 'tools/call' && typeof name === 'string') {
          for (const { header, path } of toolHeaders.get(name) ?? []) {
            const value = valueAtPath(params?.arguments, path);
            if (['string', 'number', 'boolean'].includes(typeof value)) {
              headers.set(header, headerValue(String(value)));
            }
          }
        }
      }
      if (controller.signal.aborted) throw new Error('WordPress request aborted');
      const response = await proxyFetch(String(url), {
        ...init,
        headers,
        signal: controller.signal,
      });
      // node-fetch (used with SOCKS/PAC) exposes a Node stream; the SDK requires Web streams.
      const body =
        response.body && typeof (response.body as any).getReader !== 'function'
          ? (Readable.toWeb(response.body as unknown as Readable) as ReadableStream<Uint8Array>)
          : response.body;
      const reader = body?.getReader();
      const stream = reader
        ? new ReadableStream<Uint8Array>({
            async pull(output) {
              try {
                const { value, done } = await reader.read();
                if (done) {
                  cleanup();
                  output.close();
                } else output.enqueue(value);
              } catch (error) {
                if (cancelled) {
                  cleanup();
                  output.close();
                } else output.error(failure(error));
              }
            },
            async cancel(reason) {
              cleanup();
              await reader.cancel(reason);
            },
          })
        : null;
      if (!stream) cleanup();
      const wrapped = new Response(stream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      if (!response.ok && init?.method === 'POST') {
        const text = await wrapped.text();
        let rpc: JSONRPCMessage | undefined;
        try {
          rpc = JSONRPCMessageSchema.parse(JSON.parse(text));
        } catch {}
        // The SDK otherwise discards JSON-RPC errors carried by non-2xx HTTP statuses.
        if (rpc && 'error' in rpc) {
          return new Response(JSON.stringify(rpc), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        throw new APIError(
          `WordPress API error (${response.status}): ${text}`,
          response.status,
          String(url),
          text
        );
      }
      return wrapped;
    } catch (error) {
      // A cancelled request ends quietly; the client already abandoned it.
      if (cancelled) {
        cleanup();
        return new Response(null, { status: 202 });
      }
      throw failure(error);
    }
  };
  return Object.assign(new StreamableHTTPClientTransport(new URL(getRequestUrl()), { fetch }), {
    cancelRequest(id: string | number) {
      inflight.get(id)?.();
    },
    rememberTools(tools: unknown[]) {
      for (const tool of tools) {
        const { name, inputSchema } = (tool ?? {}) as { name?: unknown; inputSchema?: unknown };
        if (typeof name === 'string') toolHeaders.set(name, collectHeaderParams(inputSchema));
      }
    },
  });
}
