export interface Account {
  id: string;
  name: string;
  kind: 'configDir' | 'manual';
  configDir?: string;
  keychainService?: string;
}

export interface UsageWindow {
  key: string;
  label: string;
  /** Percent of the limit used, 0–100. */
  utilization: number;
  /** ISO timestamp of when the window resets. */
  resetsAt?: string;
}

export interface AccountState {
  account: Account;
  email?: string;
  org?: string;
  plan?: string;
  windows?: UsageWindow[];
  updatedAt?: number;
  error?: string;
  needsLogin?: boolean;
  loading?: boolean;
}
