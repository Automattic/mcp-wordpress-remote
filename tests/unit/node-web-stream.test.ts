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
});

describe('WordPress transport with a Node stream body (SOCKS/PAC)', () => {
  it('survives a 202 whose buffered body the SDK releases unread', async () => {
    jest.resetModules();
    const api = await import('../../src/lib/wordpress-api.js');
    const fetch = await import('../../src/lib/fetch-utils.js');
    jest
      .spyOn(api, 'getWordPressHeaders')
      .mockResolvedValue({ Authorization: 'Bearer fixture-token' });
    jest.spyOn(fetch, 'proxyFetch').mockImplementation(async () => {
      const body = new PassThrough();
      body.write('{"jsonrpc":"2.0"}'); // some servers send a short body with 202 Accepted
      return {
        ok: true,
        status: 202,
        statusText: 'Accepted',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        body,
      } as any;
    });
    const { createWordPressTransport } = await import('../../src/lib/wordpress-transport.js');
    const transport = createWordPressTransport(() => {});
    transport.onerror = () => {};
    const uncaught = await captureUncaught(async () => {
      await transport.start();
      await transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as any);
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    await transport.close();
    expect(uncaught).toEqual([]);
  });
});
