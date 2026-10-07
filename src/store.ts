import * as vscode from 'vscode';
import { readProfile, resolveAccounts } from './accounts';
import { loadCredentials } from './credentials';
import { UsageError, fetchUsage } from './usage';
import { Account, AccountState } from './types';

const CACHE_KEY = 'claudeUsage.cache';
type CacheEntry = Pick<AccountState, 'windows' | 'updatedAt' | 'plan' | 'email' | 'org'>;

export class UsageStore implements vscode.Disposable {
  private accounts: Account[] = [];
  private states = new Map<string, AccountState>();
  private backoffUntil = new Map<string, number>();
  private inflight?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private lastRefresh = 0;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor(private readonly ctx: vscode.ExtensionContext) {
    for (const [id, entry] of Object.entries(ctx.globalState.get<Record<string, CacheEntry>>(CACHE_KEY, {}))) {
      this.states.set(id, { account: { id, name: '', kind: 'configDir' }, ...entry });
    }
  }

  get list(): AccountState[] {
    return this.accounts.map((a) => this.states.get(a.id)!);
  }

  get intervalMs(): number {
    return Math.max(60, vscode.workspace.getConfiguration('claudeUsage').get<number>('refreshIntervalSeconds', 300)) * 1000;
  }

  start(): void {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.refresh(), this.intervalMs);
    void this.refresh(true);
  }

  refreshIfStale(): void {
    if (Date.now() - this.lastRefresh > this.intervalMs) void this.refresh();
  }

  refresh(force = false): Promise<void> {
    this.inflight ??= this.doRefresh(force).finally(() => (this.inflight = undefined));
    return this.inflight;
  }

  private async doRefresh(force: boolean): Promise<void> {
    this.lastRefresh = Date.now();
    this.accounts = await resolveAccounts(this.ctx);
    for (const a of this.accounts) {
      const st = this.states.get(a.id) ?? { account: a };
      st.account = a;
      st.loading = true;
      this.states.set(a.id, st);
    }
    this.changed.fire();
    await Promise.all(this.accounts.map((a) => this.refreshOne(this.states.get(a.id)!, force)));
    await this.saveCache();
    this.changed.fire();
  }

  private async refreshOne(st: AccountState, force: boolean): Promise<void> {
    const a = st.account;
    try {
      if (a.configDir) Object.assign(st, await readProfile(a.configDir));
      if (!force && Date.now() < (this.backoffUntil.get(a.id) ?? 0)) return;

      const creds = await loadCredentials(a, this.ctx.secrets);
      if (creds.subscriptionType) st.plan = creds.subscriptionType;
      if (creds.expiresAt && creds.expiresAt < Date.now()) {
        throw new UsageError('Login expired — open Claude Code with this profile to refresh it.', 401);
      }
      st.windows = await fetchUsage(creds.accessToken);
      st.updatedAt = Date.now();
      st.error = undefined;
      st.needsLogin = false;
      this.backoffUntil.delete(a.id);
    } catch (e) {
      const err = e as UsageError & { needsLogin?: boolean };
      st.error = err.message;
      st.needsLogin = err.needsLogin || err.status === 401;
      if (err.status === 429) this.backoffUntil.set(a.id, Date.now() + (err.retryAfterMs ?? 5 * 60_000));
    } finally {
      st.loading = false;
    }
  }

  private async saveCache(): Promise<void> {
    const cache: Record<string, CacheEntry> = {};
    for (const { account, windows, updatedAt, plan, email, org } of this.list) {
      if (windows) cache[account.id] = { windows, updatedAt, plan, email, org };
    }
    await this.ctx.globalState.update(CACHE_KEY, cache);
  }

  dispose(): void {
    clearInterval(this.timer);
    this.changed.dispose();
  }
}
