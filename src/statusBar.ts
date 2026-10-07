import * as vscode from 'vscode';
import { formatPlan, formatReset } from './format';
import { AccountState } from './types';
import { UsageStore } from './store';

const pct = (n?: number) => (n === undefined ? '–' : `${Math.round(n)}%`);
const win = (s: AccountState, key: string) => s.windows?.find((w) => w.key === key);
const peak = (s: AccountState) => Math.max(0, ...(s.windows ?? []).map((w) => w.utilization));

export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('claudeUsage.status', vscode.StatusBarAlignment.Right, 100);

  constructor(private readonly store: UsageStore) {
    this.item.name = 'Claude Usage';
    this.item.command = 'claudeUsage.showPanel';
  }

  update(): void {
    const cfg = vscode.workspace.getConfiguration('claudeUsage');
    const mode = cfg.get<string>('statusBar', 'all');
    const states = this.store.list;
    if (mode === 'off' || states.length === 0) {
      this.item.hide();
      return;
    }

    const shown = mode === 'highest' ? [...states].sort((a, b) => peak(b) - peak(a)).slice(0, 1) : states;
    const multi = states.length > 1;
    const parts = shown.map((s) => {
      const label = multi ? `${s.account.name} ` : '';
      if (!s.windows) return `${label}${s.error ? '$(warning)' : '$(loading~spin)'}`;
      const warn = s.error ? ' $(warning)' : '';
      return `${label}${pct(win(s, 'five_hour')?.utilization)} · ${pct(win(s, 'seven_day')?.utilization)}${warn}`;
    });
    this.item.text = `$(pulse) ${parts.join('   ')}`;

    const max = Math.max(...states.map(peak));
    this.item.backgroundColor =
      max >= cfg.get<number>('dangerThreshold', 90)
        ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : max >= cfg.get<number>('warningThreshold', 75)
          ? new vscode.ThemeColor('statusBarItem.warningBackground')
          : undefined;

    const md = new vscode.MarkdownString('', true);
    md.appendMarkdown('**Claude usage** — 5-hour · weekly\n\n');
    for (const s of states) {
      const sub = [s.email, formatPlan(s.plan)].filter(Boolean).join(' · ');
      md.appendMarkdown(`---\n\n**${s.account.name}**${sub ? ` — ${sub}` : ''}\n\n`);
      for (const w of s.windows ?? []) {
        md.appendMarkdown(`- ${w.label}: **${pct(w.utilization)}** ${formatReset(w.resetsAt)}\n`);
      }
      if (s.error) md.appendMarkdown(`\n$(warning) ${s.error}\n`);
      md.appendMarkdown('\n');
    }
    md.appendMarkdown('---\n\nClick to open the usage panel.');
    this.item.tooltip = md;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
