import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { UsageStore } from './store';

export class UsagePanel implements vscode.WebviewViewProvider {
  static readonly viewId = 'claudeUsage.panel';
  private view?: vscode.WebviewView;

  constructor(private readonly store: UsageStore) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg) => {
      switch (msg?.type) {
        case 'ready':
          return this.post();
        case 'refresh':
          return vscode.commands.executeCommand('claudeUsage.refresh');
        case 'add':
          return vscode.commands.executeCommand('claudeUsage.addAccount');
        case 'login':
          return vscode.commands.executeCommand('claudeUsage.login', msg.id);
      }
    });
    view.onDidChangeVisibility(() => view.visible && this.store.refreshIfStale());
  }

  post(): void {
    if (!this.view) return;
    const cfg = vscode.workspace.getConfiguration('claudeUsage');
    void this.view.webview.postMessage({
      type: 'state',
      warn: cfg.get<number>('warningThreshold', 75),
      danger: cfg.get<number>('dangerThreshold', 90),
      accounts: this.store.list,
    });
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { padding: 8px 12px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); }
  .card { border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 6px; padding: 10px 12px; margin-bottom: 10px; background: var(--vscode-sideBar-background); }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 8px; }
  .name { font-weight: 600; }
  .sub { opacity: .7; font-size: .9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .plan { font-size: .8em; padding: 1px 6px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); white-space: nowrap; }
  .win { margin: 8px 0; }
  .row { display: flex; justify-content: space-between; font-size: .95em; }
  .pct { font-variant-numeric: tabular-nums; font-weight: 600; }
  .bar { height: 6px; border-radius: 3px; background: var(--vscode-editorWidget-background, rgba(128,128,128,.2)); overflow: hidden; margin: 4px 0 2px; outline: 1px solid rgba(128,128,128,.15); }
  .fill { height: 100%; border-radius: 3px; background: var(--vscode-charts-blue, #3794ff); transition: width .3s; }
  .fill.warn { background: var(--vscode-charts-yellow, #cca700); }
  .fill.danger { background: var(--vscode-charts-red, #f14c4c); }
  .reset, .foot { opacity: .65; font-size: .85em; font-variant-numeric: tabular-nums; }
  .err { margin-top: 8px; padding: 6px 8px; border-radius: 4px; font-size: .9em; background: var(--vscode-inputValidation-warningBackground); border: 1px solid var(--vscode-inputValidation-warningBorder); }
  .err button { margin-top: 6px; }
  .toolbar { display: flex; gap: 6px; margin-bottom: 10px; }
  button { font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: none; padding: 4px 10px; border-radius: 2px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  .empty { opacity: .8; line-height: 1.5; }
</style>
</head>
<body>
<div class="toolbar">
  <button id="refresh">Refresh</button>
  <button id="add" class="secondary">Add account</button>
</div>
<div id="root"><div class="empty">Loading…</div></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  let state = null;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dur = (ms) => {
    const mins = Math.max(0, Math.round(ms / 60000)), d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + m + 'm' : m + 'm';
  };
  const fmtTime = (d) => {
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                   : d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  };
  const reset = (iso) => {
    if (!iso) return '';
    const d = new Date(iso), ms = d - Date.now();
    return ms <= 0 ? 'Reset — refresh pending' : 'Resets in ' + dur(ms) + ' · ' + fmtTime(d);
  };
  const ago = (t) => { const ms = Date.now() - t; return ms < 60000 ? 'just now' : dur(ms) + ' ago'; };

  function render() {
    const root = document.getElementById('root');
    if (!state) return;
    if (!state.accounts.length) {
      root.innerHTML = '<div class="empty">No Claude accounts found.<br>Log in with <code>claude</code>, or click <b>Add account</b> to point at a <code>CLAUDE_CONFIG_DIR</code> profile.</div>';
      return;
    }
    root.innerHTML = state.accounts.map((s) => {
      const sub = [s.email, s.org && s.org !== s.email ? s.org : ''].filter(Boolean).join(' · ');
      const plan = s.plan ? '<span class="plan">' + esc(s.plan[0].toUpperCase() + s.plan.slice(1)) + '</span>' : '';
      const wins = (s.windows || []).map((w) => {
        const p = Math.max(0, Math.min(100, w.utilization));
        const lvl = p >= state.danger ? 'danger' : p >= state.warn ? 'warn' : '';
        return '<div class="win"><div class="row"><span>' + esc(w.label) + '</span><span class="pct">' + Math.round(w.utilization) + '%</span></div>'
          + '<div class="bar"><div class="fill ' + lvl + '" style="width:' + p + '%"></div></div>'
          + '<div class="reset">' + esc(reset(w.resetsAt)) + '</div></div>';
      }).join('');
      const err = s.error ? '<div class="err">' + esc(s.error)
        + (s.needsLogin && s.account.kind === 'configDir' ? '<br><button class="secondary" data-login="' + esc(s.account.id) + '">Open Claude in terminal</button>' : '')
        + '</div>' : '';
      const foot = s.loading ? 'Updating…' : s.updatedAt ? 'Updated ' + ago(s.updatedAt) + (s.error ? ' (stale)' : '') : '';
      return '<section class="card"><div class="head"><div style="min-width:0"><div class="name">' + esc(s.account.name) + '</div>'
        + (sub ? '<div class="sub" title="' + esc(sub) + '">' + esc(sub) + '</div>' : '') + '</div>' + plan + '</div>'
        + (wins || (s.error || s.loading ? '' : '<div class="reset">No usage windows reported.</div>'))
        + err + (foot ? '<div class="foot">' + foot + '</div>' : '') + '</section>';
    }).join('');
  }

  document.getElementById('refresh').onclick = () => vscode.postMessage({ type: 'refresh' });
  document.getElementById('add').onclick = () => vscode.postMessage({ type: 'add' });
  document.getElementById('root').addEventListener('click', (e) => {
    const id = e.target.closest('[data-login]')?.dataset.login;
    if (id) vscode.postMessage({ type: 'login', id });
  });
  window.addEventListener('message', (e) => { if (e.data?.type === 'state') { state = e.data; render(); } });
  setInterval(render, 30000);
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
