import { execFile } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { isDefaultDir } from './accounts';
import { Account } from './types';

export interface OAuthCredentials {
  accessToken: string;
  expiresAt?: number;
  subscriptionType?: string;
}

export function tokenSecretKey(accountId: string): string {
  return `claudeUsage.token.${accountId}`;
}

/**
 * Claude Code stores credentials in the Keychain under "Claude Code-credentials", suffixed with
 * the first 8 hex chars of sha256(CLAUDE_CONFIG_DIR) when a custom config dir is in use.
 */
function keychainServices(configDir: string): string[] {
  const hashed = [configDir, configDir + '/'].map(
    (v) => `Claude Code-credentials-${createHash('sha256').update(v).digest('hex').slice(0, 8)}`,
  );
  return isDefaultDir(configDir) ? ['Claude Code-credentials', ...hashed] : hashed;
}

function readKeychain(service: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('security', ['find-generic-password', '-s', service, '-w'], { timeout: 5000 }, (err, stdout) =>
      resolve(err ? undefined : stdout.trim() || undefined),
    );
  });
}

function parseCredentials(raw: string): OAuthCredentials | undefined {
  let text = raw.trim();
  if (/^[0-9a-f]+$/i.test(text) && text.length % 2 === 0) text = Buffer.from(text, 'hex').toString('utf8');
  try {
    const oauth = JSON.parse(text)?.claudeAiOauth;
    if (typeof oauth?.accessToken !== 'string') return undefined;
    return { accessToken: oauth.accessToken, expiresAt: oauth.expiresAt, subscriptionType: oauth.subscriptionType };
  } catch {
    return undefined;
  }
}

export async function loadCredentials(account: Account, secrets: vscode.SecretStorage): Promise<OAuthCredentials> {
  if (account.kind === 'manual') {
    const token = await secrets.get(tokenSecretKey(account.id));
    if (!token) throw new Error('No token stored for this account. Remove and re-add it.');
    return { accessToken: token };
  }

  const dir = account.configDir!;
  const looked: string[] = [];
  if (process.platform === 'darwin') {
    const services = account.keychainService ? [account.keychainService] : keychainServices(dir);
    for (const service of services) {
      const raw = await readKeychain(service);
      const creds = raw && parseCredentials(raw);
      if (creds) return creds;
    }
    looked.push(`Keychain "${services[0]}"`);
  }
  const file = path.join(dir, '.credentials.json');
  const raw = await fs.readFile(file, 'utf8').catch(() => undefined);
  const creds = raw && parseCredentials(raw);
  if (creds) return creds;
  looked.push(file);
  throw Object.assign(new Error(`Not logged in — no credentials in ${looked.join(' or ')}.`), { needsLogin: true });
}
