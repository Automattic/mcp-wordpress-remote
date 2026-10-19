export default async function open(url: string): Promise<void> {
  process.send?.({ kind: 'browser' });
  const authorization = new URL(url);
  setTimeout(() => {
    void fetch(authorization.searchParams.get('redirect_uri')!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'fixture-code',
        state: authorization.searchParams.get('state'),
      }),
    }).catch(error => {
      throw error;
    });
  }, 400);
}
