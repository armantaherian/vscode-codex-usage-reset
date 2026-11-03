export interface UsageWindow {
  id: "5h" | "weekly" | "other";
  /** Short label used on the status bar, such as `5h` or `Wk`. */
  label: string;
  /** Full label used in the hover tooltip. */
  statusLabel: string;
  usedPercent: number;
  resetAtMs: number | null;
}

export interface UsageSnapshot {
  source: "api" | "session";
  fetchedAtMs: number;
  planType: string | null;
  limitReached: boolean;
  fiveHour: UsageWindow | null;
  weekly: UsageWindow | null;
  extra: UsageWindow[];
  /** Banked rate-limit resets the account currently holds. */
  bankedResets: number | null;
  /** How many of those resets can clear a full window right now. */
  applicableResets: number | null;
  resetExpiriesMs: number[];
  creditsBalance: string | null;
}

export interface ContextSnapshot {
  remainingPercent: number;
  usedTokens: number;
  windowTokens: number;
  cwd: string | null;
  atMs: number | null;
  matchedWorkspace: boolean;
}

export interface SessionSnapshot {
  usage?: UsageSnapshot;
  context?: ContextSnapshot;
}

export interface UsageHistory {
  /** Token totals for Monday–Sunday, each with local hours 0–23. */
  cells: number[][];
  totalTokens: number;
  fromMs: number;
  toMs: number;
}

export interface StatusInput {
  usage?: UsageSnapshot;
  context?: ContextSnapshot;
  history?: UsageHistory;
  /** Hover tile colors follow the editor theme. */
  theme?: "light" | "dark";
  now: number;
  problem?: string;
}
