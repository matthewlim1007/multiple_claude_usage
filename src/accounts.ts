import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Account } from './types';

export const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.claude');
export const MANUAL_ACCOUNTS_KEY = 'claudeUsage.manualAccounts';

interface ConfiguredAccount {
  name?: string;
  configDir: string;
  keychainService?: string;
}

export function normalizeDir(p: string): string {
  const expanded = p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
  return path.resolve(expanded);
}

export function isDefaultDir(dir: string): boolean {
  return normalizeDir(dir) === DEFAULT_CONFIG_DIR;
}

function defaultName(dir: string): string {
  const base = path.basename(dir);
  if (base === '.claude') return 'default';
  return base.replace(/^\.?claude[-_.]?/, '') || base;
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true, () => false);
}

/** Finds `~/.claude` and `~/.claude-*` directories that look like Claude Code config dirs. */
export async function discoverConfigDirs(): Promise<string[]> {
  const home = os.homedir();
  const entries = await fs.readdir(home, { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !/^\.claude([-_.].+)?$/.test(e.name)) continue;
    const dir = path.join(home, e.name);
    if (dir === DEFAULT_CONFIG_DIR) {
      found.push(dir);
      continue;
    }
    const markers = ['.claude.json', '.credentials.json', 'settings.json', 'projects'];
    for (const m of markers) {
      if (await exists(path.join(dir, m))) {
        found.push(dir);
        break;
      }
    }
  }
  return found.sort((a, b) => (a === DEFAULT_CONFIG_DIR ? -1 : b === DEFAULT_CONFIG_DIR ? 1 : a.localeCompare(b)));
}

export async function resolveAccounts(ctx: vscode.ExtensionContext): Promise<Account[]> {
  const cfg = vscode.workspace.getConfiguration('claudeUsage');
  const excluded = new Set(cfg.get<string[]>('excludeDirs', []).map(normalizeDir));
  const byDir = new Map<string, Account>();

  if (cfg.get<boolean>('autoDiscover', true)) {
    for (const dir of await discoverConfigDirs()) {
      byDir.set(dir, { id: `dir:${dir}`, name: defaultName(dir), kind: 'configDir', configDir: dir });
    }
  }
  for (const c of cfg.get<ConfiguredAccount[]>('accounts', [])) {
    if (!c?.configDir) continue;
    const dir = normalizeDir(c.configDir);
    byDir.set(dir, {
      id: `dir:${dir}`,
      name: c.name || byDir.get(dir)?.name || defaultName(dir),
      kind: 'configDir',
      configDir: dir,
      keychainService: c.keychainService,
    });
  }
  for (const dir of excluded) byDir.delete(dir);

  const manual = ctx.globalState.get<Account[]>(MANUAL_ACCOUNTS_KEY, []);
  return [...byDir.values(), ...manual];
}

/** Reads the logged-in account's email/org from the profile's .claude.json (no secrets in there). */
export async function readProfile(configDir: string): Promise<{ email?: string; org?: string }> {
  const candidates = isDefaultDir(configDir)
    ? [path.join(configDir, '.claude.json'), path.join(os.homedir(), '.claude.json')]
    : [path.join(configDir, '.claude.json')];
  for (const file of candidates) {
    try {
      const json = JSON.parse(await fs.readFile(file, 'utf8'));
      const acct = json?.oauthAccount;
      if (acct) return { email: acct.emailAddress, org: acct.organizationName };
    } catch {
      // try next candidate
    }
  }
  return {};
}
