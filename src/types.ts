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
