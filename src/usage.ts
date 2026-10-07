import { UsageWindow } from './types';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

const LABELS: Record<string, string> = {
  five_hour: '5-hour',
  seven_day: 'Weekly',
  seven_day_sonnet: 'Weekly · Sonnet',
  seven_day_opus: 'Weekly · Opus',
  seven_day_oauth_apps: 'Weekly · OAuth apps',
};
const ORDER = Object.keys(LABELS);

export class UsageError extends Error {
  constructor(message: string, readonly status?: number, readonly retryAfterMs?: number) {
    super(message);
  }
}

export function parseUsage(json: unknown): UsageWindow[] {
  const windows: UsageWindow[] = [];
  for (const [key, v] of Object.entries((json ?? {}) as Record<string, any>)) {
    if (!v || typeof v !== 'object' || typeof v.utilization !== 'number') continue;
    windows.push({
      key,
      label: LABELS[key] ?? key.replace(/_/g, ' '),
      utilization: v.utilization,
      resetsAt: typeof v.resets_at === 'string' ? v.resets_at : undefined,
    });
  }
  const rank = (k: string) => (ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length);
  return windows.sort((a, b) => rank(a.key) - rank(b.key));
}

export async function fetchUsage(accessToken: string): Promise<UsageWindow[]> {
  let res: Response;
  try {
    res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
        'User-Agent': 'claude-usage-vscode/0.1.0',
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new UsageError(`Network error: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 200);
    switch (res.status) {
      case 401:
        throw new UsageError('Login expired or revoked — open Claude Code with this profile to refresh it.', 401);
      case 403:
        throw new UsageError('This token is not allowed to read usage (it needs the user:profile scope).', 403);
      case 429: {
        const retry = Number(res.headers.get('retry-after'));
        throw new UsageError('Rate limited by the usage API; will retry later.', 429, retry > 0 ? retry * 1000 : undefined);
      }
      default:
        throw new UsageError(`Usage API returned HTTP ${res.status}${body ? `: ${body}` : ''}`, res.status);
    }
  }
  return parseUsage(await res.json());
}
