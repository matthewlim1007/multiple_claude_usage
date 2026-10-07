export function formatDuration(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatReset(iso?: string): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  return ms <= 0 ? 'reset — refresh pending' : `resets in ${formatDuration(ms)}`;
}

export function formatPlan(plan?: string): string | undefined {
  return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : undefined;
}
