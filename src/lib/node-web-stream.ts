import type { Readable } from 'node:stream';

/**
 * Adapts a Node readable (the body node-fetch returns on the SOCKS/PAC path) to a Web
 * ReadableStream by pulling from its async iterator.
 *
 * `Readable.toWeb()` is push-based: it pauses the Node stream for backpressure and closes the
 * Web controller from `finished()`. When the socket closes while chunks are still buffered,
 * the controller is closed first and the buffered chunks then hit `enqueue()` on a closed
 * controller. That throws ERR_INVALID_STATE from an event listener, outside any try/catch,
 * and the process exits. Pulling on demand never enqueues after close, and a premature close
 * surfaces as a rejected read that the caller already handles.
 */
export function nodeReadableToWeb(stream: Readable): ReadableStream<Uint8Array> {
  const chunks = stream[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await chunks.next();
      if (done) controller.close();
      else
        controller.enqueue(typeof value === 'string' ? Buffer.from(value) : (value as Uint8Array));
    },
    async cancel() {
      await chunks.return?.();
      stream.destroy();
    },
  });
}
