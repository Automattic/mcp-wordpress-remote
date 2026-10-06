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

/** Keep auth and HTTP framing outside the messages being forwarded. */
export function createWordPressTransport(
  onFailure: (message: JSONRPCMessage | undefined, error: Error) => void
): StreamableHTTPClientTransport {
  const fetch: FetchLike = async (url, init) => {
    const message: JSONRPCMessage | undefined =
      typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const controller = new AbortController();
    const abort = () => controller.abort();
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
      // count against it. GET is the optional long-lived stream and has no deadline.
      if (init?.method !== 'GET') {
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
        if (typeof name === 'string') {
          const safe =
            /^[\x20-\x7e]*$/.test(name) && name.trim() === name && !/^=\?base64\?.*\?=$/.test(name);
          headers.set(
            'Mcp-Name',
            safe ? name : `=?base64?${Buffer.from(name).toString('base64')}?=`
          );
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
                output.error(failure(error));
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
      throw failure(error);
    }
  };
  return new StreamableHTTPClientTransport(new URL(getRequestUrl()), { fetch });
}
