import { jest } from '@jest/globals';
import { PassThrough } from 'node:stream';
import { nodeReadableToWeb } from '../../src/lib/node-web-stream.js';

// node-fetch (SOCKS/PAC path) returns a Node stream body. The MCP SDK releases bodies it does
// not read (202/405). If that cancel lands while a resume is already scheduled and data is
// buffered, Readable.toWeb() still emits the chunk and enqueues into the closed controller.
function cancelWhileResumeScheduled(body: PassThrough, reader: ReadableStreamDefaultReader) {
  body.pause();
  body.write('{"jsonrpc":"2.0"}');
  body.resume();
  void reader.cancel('released by SDK');
}

async function captureUncaught(run: () => Promise<void>) {
  const uncaught: Error[] = [];
  const onUncaught = (error: Error) => uncaught.push(error);
  const listeners = process.listeners('uncaughtException');
  process.removeAllListeners('uncaughtException');
  process.on('uncaughtException', onUncaught);
  try {
    await run();
    await new Promise(resolve => setTimeout(resolve, 20));
  } finally {
    process.removeListener('uncaughtException', onUncaught);
    for (const listener of listeners) process.on('uncaughtException', listener);
  }
  return uncaught;
}

describe('nodeReadableToWeb', () => {
  it('does not throw when the consumer cancels while data is buffered', async () => {
    const uncaught = await captureUncaught(async () => {
      const body = new PassThrough();
      cancelWhileResumeScheduled(body, nodeReadableToWeb(body).getReader());
    });
    expect(uncaught).toEqual([]);
  });

  it('reads a complete body', async () => {
    const body = new PassThrough();
    const reader = nodeReadableToWeb(body).getReader();
    body.end('{"jsonrpc":"2.0","id":1,"result":{}}');
    const parts: Uint8Array[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    expect(Buffer.concat(parts).toString()).toBe('{"jsonrpc":"2.0","id":1,"result":{}}');
  });

  it('turns a premature close into a rejected read, not a process-level error', async () => {
    const uncaught = await captureUncaught(async () => {
      const body = new PassThrough();
      const reader = nodeReadableToWeb(body).getReader();
      body.write('partial');
      await expect(reader.read()).resolves.toMatchObject({ done: false });
      body.destroy();
      await expect(reader.read()).rejects.toMatchObject({ code: 'ERR_STREAM_PREMATURE_CLOSE' });
    });
    expect(uncaught).toEqual([]);
  });

  it('destroys the Node stream when the consumer cancels', async () => {
    const body = new PassThrough();
    const destroy = jest.spyOn(body, 'destroy');
    await nodeReadableToWeb(body).cancel();
    expect(destroy).toHaveBeenCalled();
  });

  it('settles cancel() while a read is still waiting for bytes', async () => {
    const body = new PassThrough();
    const reader = nodeReadableToWeb(body).getReader();
    const pending = reader.read();
    await new Promise(resolve => setImmediate(resolve)); // let pull() start awaiting next()
    const outcome = await Promise.race([
      reader.cancel().then(() => 'settled'),
      new Promise(resolve => setTimeout(() => resolve('hung'), 200)),
    ]);
    expect(outcome).toBe('settled');
    await expect(pending).resolves.toMatchObject({ done: true });
  });
});
