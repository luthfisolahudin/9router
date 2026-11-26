import { describe, it, expect, vi } from "vitest";
import {
  buildT3QuotaResponse,
  isQuotaEligibleConnection,
  mapUsageToT3QuotaAccount,
} from "../../src/lib/usage/t3Quota.js";

describe("t3Quota", () => {
  it("filters out inactive and unsupported connections", () => {
    expect(isQuotaEligibleConnection({ id: "1", provider: "commandcode", authType: "apikey", isActive: true })).toBe(true);
    expect(isQuotaEligibleConnection({ id: "2", provider: "commandcode", authType: "apikey", isActive: false })).toBe(false);
    expect(isQuotaEligibleConnection({ id: "3", provider: "openai", authType: "apikey", isActive: true })).toBe(false);
    expect(isQuotaEligibleConnection({ id: "4", provider: "codex", authType: "oauth", isActive: true })).toBe(true);
  });

  it("maps commandcode quotas to T3 HttpQuotaAccount with inferred window kinds", () => {
    const account = mapUsageToT3QuotaAccount(
      { id: "conn_1", provider: "commandcode", authType: "apikey", name: "personal" },
      {
        plan: "GOAT",
        quotas: {
          Credits: { used: 56, total: 70, resetAt: "2026-10-01T00:00:00.000Z" },
          "Session (5h)": { used: 2, total: 10, resetAt: "2026-09-16T10:00:00.000Z" },
          Weekly: { used: 20, total: 70, resetAt: "2026-09-20T00:00:00.000Z" },
        },
      },
    );

    expect(account).toEqual({
      id: "9router-commandcode-conn_1",
      label: "Command Code (personal)",
      windows: [
        {
          id: "credits",
          kind: "monthly",
          label: "Credits",
          usedPercent: 80,
          resetsAt: "2026-10-01T00:00:00.000Z",
        },
        {
          id: "session-5h",
          kind: "session",
          label: "Session (5h)",
          usedPercent: 20,
          resetsAt: "2026-09-16T10:00:00.000Z",
        },
        {
          id: "weekly",
          kind: "weekly",
          label: "Weekly",
          usedPercent: 29,
          resetsAt: "2026-09-20T00:00:00.000Z",
        },
      ],
    });
  });

  it("aggregates fulfilled accounts and skips failing connections", async () => {
    const fetcher = vi.fn(async (conn) => {
      if (conn.id === "bad") throw new Error("timeout");
      return {
        plan: "Plus",
        quotas: {
          session: { used: 25, total: 100, remaining: 75, resetAt: "2026-11-26T12:00:00.000Z" },
        },
      };
    });

    const result = await buildT3QuotaResponse(
      [
        { id: "bad", provider: "codex", authType: "oauth", isActive: true },
        { id: "ok", provider: "codex", authType: "oauth", email: "user@example.test", isActive: true },
      ],
      fetcher,
    );

    expect(result).toEqual({
      version: 1,
      accounts: [
        {
          id: "9router-codex-ok",
          label: "OpenAI Codex (user@example.test)",
          windows: [
            {
              id: "5h",
              kind: "session",
              label: "5h",
              usedPercent: 25,
              resetsAt: "2026-11-26T12:00:00.000Z",
            },
          ],
        },
      ],
    });
  });
});
