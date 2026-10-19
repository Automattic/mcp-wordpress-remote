export default async function open(url: string): Promise<void> {
  const authorization = new URL(url);
  process.send?.({ kind: 'browser', scope: authorization.searchParams.get('scope') });
  setTimeout(() => {
    void fetch(authorization.searchParams.get('redirect_uri')!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(process.env.OAUTH_FIXTURE_DENY === 'true'
          ? { error: 'access_denied' }
          : { code: 'fixture-code' }),
        iss: authorization.origin,
        state: authorization.searchParams.get('state'),
      }),
    }).catch(error => {
      throw error;
    });
  }, 400);
}
