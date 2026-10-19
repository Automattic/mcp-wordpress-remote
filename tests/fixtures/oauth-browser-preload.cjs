const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');

childProcess.spawn = (_command, arguments_) => {
  const target = arguments_.find(
    value => typeof value === 'string' && /^http:\/\/127\.0\.0\.1:\d+\/authorize\?/.test(value)
  );
  if (!target) throw new Error('Unexpected subprocess during isolated OAuth artifact test');
  const authorization = new URL(target);
  process.send?.({ kind: 'browser', scope: authorization.searchParams.get('scope') });
  const child = new EventEmitter();
  child.unref = () => {};
  setTimeout(() => {
    void fetch(authorization.searchParams.get('redirect_uri'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(process.env.OAUTH_FIXTURE_DENY === 'true'
          ? { error: 'access_denied' }
          : { code: 'fixture-code' }),
        state: authorization.searchParams.get('state'),
        iss: authorization.origin,
      }),
    }).catch(error => {
      throw error;
    });
  }, 400);
  return child;
};
require('node:module').syncBuiltinESMExports();
