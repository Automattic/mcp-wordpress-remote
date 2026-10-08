import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import ts from 'typescript';

const terminator = Buffer.from('0\r\n\r\n');

// Exercise the code consumers actually install, including any Buffer renaming
// performed by esbuild. Both entry bundles embed their own node-fetch copy.
describe.each(['lib.js', 'proxy.js'])('bundled node-fetch in %s', filename => {
  let detector: (request: EventEmitter, onError: (error: Error) => void) => void;

  beforeAll(() => {
    const bundlePath = path.join(
      process.env.NODE_FETCH_BUNDLE_DIR || path.resolve(__dirname, '../../dist'),
      filename
    );
    const source = ts.createSourceFile(
      bundlePath,
      fs.readFileSync(bundlePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    );
    const detectors: ts.FunctionDeclaration[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isFunctionDeclaration(node) &&
        /^fixResponseChunkedTransferBadEnding\d*$/.test(node.name?.text || '')
      ) {
        detectors.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(detectors).toHaveLength(1);
    const text = detectors[0].getText(source);
    const bufferNames = [...text.matchAll(/\b(Buffer\d*)\./g)].map(match => match[1]);
    detector = vm.runInNewContext(
      `(${text})`,
      Object.fromEntries(bufferNames.map(name => [name, Buffer]))
    );
  });

  function observe(headers = { 'transfer-encoding': 'chunked' }) {
    const request = new EventEmitter();
    const socket = new EventEmitter();
    const errors: Error[] = [];
    detector(request, error => errors.push(error));
    request.emit('socket', socket);
    request.emit('response', { headers });
    return { request, socket, errors };
  }

  it.each(Array.from({ length: 32 }, (_, value) => [value % 16, value >= 16] as const))(
    'accepts all chunk terminator boundaries (partition %i, empty events %s)',
    (mask, emptyEvents) => {
      const { request, socket, errors } = observe();
      socket.emit('data', Buffer.from('2\r\nOK\r\n'));
      let start = 0;
      for (let end = 1; end <= terminator.length; end++) {
        if (end === terminator.length || mask & (1 << (end - 1))) {
          socket.emit('data', terminator.subarray(start, end));
          if (emptyEvents) socket.emit('data', Buffer.alloc(0));
          start = end;
        }
      }
      socket.emit('close');
      expect(errors).toEqual([]);
      request.emit('close');
      expect(socket.listenerCount('data')).toBe(0);
      expect(socket.listenerCount('close')).toBe(0);
    }
  );

  it('accepts the terminator in one large data event', () => {
    const { socket, errors } = observe();
    socket.emit('data', Buffer.concat([Buffer.alloc(65536, 'a'), terminator]));
    socket.emit('close');
    expect(errors).toEqual([]);
  });

  it.each([0, 1, 2, 3, 4])('rejects a truncated terminator of %i bytes', length => {
    const { socket, errors } = observe();
    socket.emit('data', Buffer.from('2\r\nOK\r\n'));
    socket.emit('data', terminator.subarray(0, length));
    socket.emit('close');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'ERR_STREAM_PREMATURE_CLOSE' });
  });

  it('does not mistake an earlier terminator for the final bytes', () => {
    const { socket, errors } = observe();
    socket.emit('data', terminator);
    socket.emit('data', Buffer.from('x'));
    socket.emit('close');
    expect(errors[0]).toMatchObject({ code: 'ERR_STREAM_PREMATURE_CLOSE' });
  });

  it('does not apply chunked framing checks to other responses', () => {
    const { socket, errors } = observe({ 'transfer-encoding': 'identity' });
    socket.emit('data', Buffer.from('OK'));
    socket.emit('close');
    expect(errors).toEqual([]);
  });
});
