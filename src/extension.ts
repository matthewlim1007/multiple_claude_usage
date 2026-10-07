import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { MANUAL_ACCOUNTS_KEY, isDefaultDir, normalizeDir } from './accounts';
import { tokenSecretKey } from './credentials';
import { UsagePanel } from './panel';
import { StatusBar } from './statusBar';
import { UsageStore } from './store';
import { Account } from './types';

export function activate(ctx: vscode.ExtensionContext): void {
  const store = new UsageStore(ctx);
  const statusBar = new StatusBar(store);
  const panel = new UsagePanel(store);

  ctx.subscriptions.push(
    store,
    statusBar,
    store.onDidChange(() => {
      statusBar.update();
      panel.post();
    }),
    vscode.window.registerWebviewViewProvider(UsagePanel.viewId, panel),
    vscode.commands.registerCommand('claudeUsage.refresh', () => store.refresh(true)),
    vscode.commands.registerCommand('claudeUsage.showPanel', () => vscode.commands.executeCommand(`${UsagePanel.viewId}.focus`)),
    vscode.commands.registerCommand('claudeUsage.addAccount', () => addAccount(ctx, store)),
    vscode.commands.registerCommand('claudeUsage.removeAccount', () => removeAccount(ctx, store)),
    vscode.commands.registerCommand('claudeUsage.login', (id: string) => openLoginTerminal(store, id)),
    vscode.window.onDidChangeWindowState((s) => s.focused && store.refreshIfStale()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeUsage')) store.start();
    }),
  );
  store.start();
}

async function addAccount(ctx: vscode.ExtensionContext, store: UsageStore): Promise<void> {
  const choice = await vscode.window.showQuickPick(
    [
      { label: '$(folder) Claude Code config directory', detail: 'A profile used via CLAUDE_CONFIG_DIR, e.g. ~/.claude-work', id: 'dir' },
      { label: '$(key) OAuth access token', detail: 'Paste a token (sk-ant-oat…) — stored in VS Code secret storage', id: 'token' },
    ],
    { placeHolder: 'How should this account be read?' },
  );
  if (!choice) return;

  if (choice.id === 'dir') {
    const dirInput = await vscode.window.showInputBox({
      prompt: 'Path to the Claude Code config directory',
      value: '~/.claude-',
      validateInput: async (v) =>
        (await fs.stat(normalizeDir(v)).then((s) => s.isDirectory(), () => false)) ? undefined : 'Directory not found',
    });
    if (!dirInput) return;
    const dir = normalizeDir(dirInput);
    const name = await vscode.window.showInputBox({ prompt: 'Display name', value: dir.split('/').pop()?.replace(/^\.claude-?/, '') });
    if (name === undefined) return;

    const cfg = vscode.workspace.getConfiguration('claudeUsage');
    const accounts = cfg.get<{ configDir: string }[]>('accounts', []).filter((a) => normalizeDir(a.configDir) !== dir);
    const excluded = cfg.get<string[]>('excludeDirs', []).filter((d) => normalizeDir(d) !== dir);
    await cfg.update('excludeDirs', excluded, vscode.ConfigurationTarget.Global);
    await cfg.update('accounts', [...accounts, { name: name || undefined, configDir: dirInput }], vscode.ConfigurationTarget.Global);
  } else {
    const name = await vscode.window.showInputBox({ prompt: 'Display name for this account' });
    if (!name) return;
    const token = await vscode.window.showInputBox({ prompt: 'OAuth access token', password: true, ignoreFocusOut: true });
    if (!token) return;
    const account: Account = { id: `manual:${Date.now()}`, name, kind: 'manual' };
    await ctx.secrets.store(tokenSecretKey(account.id), token.trim());
    await ctx.globalState.update(MANUAL_ACCOUNTS_KEY, [...ctx.globalState.get<Account[]>(MANUAL_ACCOUNTS_KEY, []), account]);
    await store.refresh(true);
  }
}

async function removeAccount(ctx: vscode.ExtensionContext, store: UsageStore): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    store.list.map((s) => ({ label: s.account.name, description: s.email ?? s.account.configDir, account: s.account })),
    { placeHolder: 'Stop tracking which account?' },
  );
  if (!pick) return;
  const a = pick.account;
  if (a.kind === 'manual') {
    await ctx.secrets.delete(tokenSecretKey(a.id));
    await ctx.globalState.update(
      MANUAL_ACCOUNTS_KEY,
      ctx.globalState.get<Account[]>(MANUAL_ACCOUNTS_KEY, []).filter((m) => m.id !== a.id),
    );
    await store.refresh(true);
    return;
  }
  const cfg = vscode.workspace.getConfiguration('claudeUsage');
  const dir = a.configDir!;
  await cfg.update(
    'accounts',
    cfg.get<{ configDir: string }[]>('accounts', []).filter((c) => normalizeDir(c.configDir) !== dir),
    vscode.ConfigurationTarget.Global,
  );
  // Auto-discovered dirs would come back, so exclude them explicitly.
  await cfg.update('excludeDirs', [...cfg.get<string[]>('excludeDirs', []), dir], vscode.ConfigurationTarget.Global);
}

function openLoginTerminal(store: UsageStore, id: string): void {
  const a = store.list.find((s) => s.account.id === id)?.account;
  if (!a?.configDir) return;
  const terminal = vscode.window.createTerminal({
    name: `Claude (${a.name})`,
    env: isDefaultDir(a.configDir) ? undefined : { CLAUDE_CONFIG_DIR: a.configDir },
  });
  terminal.show();
  terminal.sendText('claude');
  void vscode.window.showInformationMessage(
    `Opened Claude Code for "${a.name}". Run /login if prompted, then click Refresh in the usage panel.`,
  );
}

export function deactivate(): void {}
