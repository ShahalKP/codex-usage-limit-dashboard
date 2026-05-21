import { z } from "zod";

export const RateLimitWindowSchema = z.object({
  usedPercent: z.number(),
  windowDurationMins: z.number(),
  resetsAt: z.number(),
});

export const CodexRateLimitSchema = z.object({
  limitId: z.string(),
  limitName: z.string().nullable().optional(),
  planType: z.string().nullable().optional(),
  primary: RateLimitWindowSchema.nullable().optional(),
  secondary: RateLimitWindowSchema.nullable().optional(),
  credits: z.unknown().optional(),
  rateLimitReachedType: z.string().nullable().optional(),
});

export const CodexAccountSchema = z.union([
  z.null(),
  z.object({
    type: z.enum(["apiKey", "chatgpt", "chatgptAuthTokens"]),
    email: z.string().optional(),
    planType: z.string().nullable().optional(),
  }),
]);

export const AccountReadResultSchema = z.object({
  account: CodexAccountSchema,
  requiresOpenaiAuth: z.boolean().optional(),
});

export const RateLimitsReadResultSchema = z.object({
  rateLimits: CodexRateLimitSchema.nullable().optional(),
  rateLimitsByLimitId: z.record(z.string(), CodexRateLimitSchema).optional(),
});
