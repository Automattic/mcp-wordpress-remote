import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { CONFIG } from './config.js';
import { validateOAuthUrl } from './oauth-http.js';
import { APIError } from './oauth-types.js';
import { ensureConfigDir, getConfigFilePath, readJsonFile } from './persistent-auth-config.js';
import type { AuthorizationRequest } from './mcp-oauth-provider.js';

export function approvalBase(): string | undefined {
  const mode = process.env.OAUTH_APPROVAL_MODE || 'browser';
  if (mode === 'browser') return;
  if (mode !== 'deferred') throw new Error('Unknown OAUTH_APPROVAL_MODE');
  if (
    !CONFIG.OAUTH_ENABLED ||
    CONFIG.OAUTH_FLOW_TYPE !== 'authorization_code' ||
    !CONFIG.OAUTH_USE_PKCE
  )
    throw new Error('Deferred approval requires OAuth authorization code with PKCE');
  const base = validateOAuthUrl(process.env.OAUTH_APPROVAL_BASE_URL || '');
  if (base.search) throw new Error('Approval base URL cannot include a query');
  return base.href.replace(/\/+$/, '');
}

export interface Ticket {
  id: string;
  request: Omit<AuthorizationRequest, 'rejectedToken'>;
  rejectedFingerprint?: string;
}

export function fingerprint(token?: string) {
  return token && createHash('sha256').update(token).digest('hex');
}

export class ApprovalRequired extends APIError {
  constructor(readonly url: string) {
    super('OAuth approval required. Open ' + url, 401, url, undefined, 'AUTH_REQUIRED');
  }
}

// Called under the provider's per-resource OAuth lock.
export async function deferApproval(hash: string, request: AuthorizationRequest): Promise<never> {
  const base = approvalBase()!;
  await ensureConfigDir();
  const prior = await readJsonFile<Ticket>(hash, 'approval.json');
  const { rejectedToken, ...parameters } = request;
  const ticket: Ticket = {
    id: prior?.id ?? randomUUID(),
    request: parameters,
    rejectedFingerprint: fingerprint(rejectedToken),
  };
  const file = getConfigFilePath(hash, 'approval.json');
  const temp = file + '.' + randomUUID();
  try {
    await fs.writeFile(temp, JSON.stringify(ticket), { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
  throw new ApprovalRequired(base + '/connect/' + ticket.id);
}

export interface ApprovalRedirect {
  uri: string;
  redirect(url: string, localCallback: string): void;
}
