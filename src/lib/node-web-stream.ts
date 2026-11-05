import type { Readable } from 'node:stream';

/**
 * Adapts a Node readable (the body node-fetch returns on the SOCKS/PAC path) to a Web
 * ReadableStream by pulling from its async iterator.
 *
 * `Readable.toWeb()` is push-based: it pauses the Node stream for backpressure and closes the
 * Web controller from `finished()`. The MCP SDK cancels bodies it does not read (a 202 to a
 * notification, a 405 to the event-stream GET). If that cancel lands while a resume is already
 * scheduled and chunks are buffered, the Node stream still emits them and they hit `enqueue()`
 * on the closed controller. That throws ERR_INVALID_STATE from an event listener, outside any
 * try/catch, and the process exits. Pulling on demand never enqueues after cancel or close,
 * and a premature close surfaces as a rejected read that the caller already handles.
 */
export function nodeReadableToWeb(stream: Readable): ReadableStream<Uint8Array> {
  const chunks = stream[Symbol.asyncIterator]();
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await chunks.next();
      // A next() that was pending when the consumer cancelled can still resolve; the
      // controller is closed by then, so drop the result instead of enqueueing into it.
      if (cancelled) return;
      if (done) controller.close();
      else
        controller.enqueue(typeof value === 'string' ? Buffer.from(value) : (value as Uint8Array));
    },
    async cancel() {
      cancelled = true;
      // Destroy first. The iterator is an async generator, so return() queues behind the
      // next() that pull() may still be awaiting; with no more bytes coming it would never
      // settle. Destroying rejects that next() with ERR_STREAM_PREMATURE_CLOSE, so return()
      // settles immediately.
      stream.destroy();
      await chunks.return?.();
    },
  });
}
