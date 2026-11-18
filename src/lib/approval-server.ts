import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { approvalBase, fingerprint, type Ticket } from './deferred-approval.js';
import { MCPOAuthProvider } from './mcp-oauth-provider.js';
import { generateServerUrlHash, readJsonFile } from './persistent-auth-config.js';
import { CONFIG } from './config.js';
import { getRequestUrl } from './wordpress-api.js';

export function serveApprovals() {
  const base = approvalBase();
  if (!base) throw new Error('The approval service requires deferred mode');
  const origin = new URL(base).origin;
  const root = new URL(base).pathname.replace(/\/$/, '');
  const cookiePath = root + '/callback';
  const serverUrl = getRequestUrl();
  const hash = generateServerUrlHash(serverUrl);
  const cookieName = 'approval_' + hash + '=';
  const port = Number(process.env.OAUTH_APPROVAL_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Set OAUTH_APPROVAL_PORT');
  type Flow = { cookie: string; callback?: string; done?: Promise<void> };
  let active: Flow | undefined;

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url!, origin);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    const reply = (status: number, body: string) => {
      res.writeHead(status);
      res.end(body);
    };
    if (req.method === 'GET' && url.pathname === cookiePath) {
      const flow = active;
      if (!flow?.callback || !req.headers.cookie?.split(/;\s*/).includes(cookieName + flow.cookie))
        return reply(400, 'Open the approval link again in this browser.');
      const response = await fetch(flow.callback, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(url.searchParams)),
      });
      if (!response.ok) return reply(400, 'Authorization response rejected.');
      await flow.done;
      return reply(200, 'Connected. You can return to your MCP client.');
    }
    const ticket = await readJsonFile<Ticket>(hash, 'approval.json');
    if (!ticket || url.pathname !== root + '/connect/' + ticket.id)
      return reply(404, 'Unknown link.');
    if (req.method === 'GET') {
      // A no-referrer document makes browsers send Origin: null on form POST.
      res.setHeader('Referrer-Policy', 'strict-origin');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return reply(
        200,
        '<meta name="viewport" content="width=device-width"><title>Connect MCP</title><h1>Connect to ' +
          new URL(serverUrl).hostname +
          '</h1><form method="post"><button>Continue to authorization</button></form>'
      );
    }
    if (req.method !== 'POST' || req.headers.origin !== origin)
      return reply(403, 'Invalid request.');
    if (active)
      return reply(409, 'Approval already in progress. Finish it or retry after it expires.');
    const flow: Flow = { cookie: randomUUID() };
    active = flow;
    try {
      const provider = new MCPOAuthProvider(
        { serverUrl },
        {
          uri: base + '/callback',
          redirect(location, callback) {
            flow.callback = callback;
            res.setHeader(
              'Set-Cookie',
              cookieName +
                flow.cookie +
                '; HttpOnly; SameSite=Lax; Path=' +
                cookiePath +
                (origin.startsWith('https:') ? '; Secure' : '')
            );
            res.setHeader('Location', location);
            reply(303, '');
          },
        }
      );
      const current = await provider.tokens();
      flow.done = provider.authorize({
        ...ticket.request,
        rejectedToken:
          current && fingerprint(current.access_token) === ticket.rejectedFingerprint
            ? current.access_token
            : undefined,
      });
      await flow.done;
      if (!res.headersSent) reply(200, 'Already connected.');
    } finally {
      active = undefined;
    }
  }
  createServer((req, res) => {
    void handle(req, res).catch((error: Error) => {
      console.error('Approval failed:', error.message);
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('Approval failed. Open the link to try again.');
      }
    });
  }).listen(port, '127.0.0.1');
}
