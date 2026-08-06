export type JsonRpcRequest = {
  id?: number;
  method: string;
  params?: unknown;
};

export type JsonRpcResponse<T = unknown> = {
  id?: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  method?: string;
  params?: unknown;
};

export type CodexAccount = null | {
  type: "apiKey" | "chatgpt" | "chatgptAuthTokens";
  email?: string;
  planType?: string | null;
};

export type RateLimitWindow = {
  usedPercent: number;
  windowDurationMins: number;
  resetsAt: number;
};

export type CodexRateLimit = {
  limitId: string;
  limitName?: string | null;
  planType?: string | null;
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
  credits?: unknown;
  rateLimitReachedType?: string | null;
};

export type AccountReadResult = {
  account: CodexAccount;
  requiresOpenaiAuth?: boolean;
};

export type RateLimitsReadResult = {
  rateLimits?: CodexRateLimit | null;
  rateLimitsByLimitId?: Record<string, CodexRateLimit>;
};

export type HistoryPersistenceAction = "inserted" | "coalesced";

export type UsageSnapshotData = {
  fetchedAt: string;
  account: CodexAccount;
  selectedLimit: CodexRateLimit | null;
  allLimits: CodexRateLimit[];
};

export type UsageHistoryStatus = {
  persisted: boolean;
  action: HistoryPersistenceAction | null;
  warning: string | null;
};

export type UsageSnapshot = UsageSnapshotData & {
  history?: UsageHistoryStatus;
};

export type ClaudeAuthStatus = {
  loggedIn: boolean;
  authMethod?: string;
  apiProvider?: string;
  email?: string;
  orgId?: string;
  orgName?: string;
  subscriptionType?: string;
};

export type ClaudeAccount = null | {
  type: "claude";
  email?: string;
  orgName?: string | null;
  subscriptionType?: string | null;
  userRateLimitTier?: string | null;
  organizationRateLimitTier?: string | null;
};

export type ClaudeModelUsage = {
  model: string;
  responses: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

/** A rolling lookback over local logs — NOT a quota window. */
export type ClaudeUsageWindow = {
  label: string; // e.g. "Last 5 hours"
  lookbackMins: number; // 300 | 10080
  since: string; // ISO
  responses: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  byModel: ClaudeModelUsage[]; // sorted by outputTokens desc
};

export type ClaudeUsageSnapshot = {
  fetchedAt: string;
  account: ClaudeAccount;
  windows: ClaudeUsageWindow[]; // [5h, 7d]
  scan: {
    filesScanned: number;
    responsesCounted: number;
    malformedLines: number;
    elapsedMs: number;
  };
};
