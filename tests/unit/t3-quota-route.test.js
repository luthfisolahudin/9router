import { describe, it, expect, vi } from "vitest";
import {
  buildT3QuotaResponse,
  isQuotaEligibleConnection,
  mapUsageToT3QuotaAccount,
} from "../../src/lib/usage/t3Quota.js";

// Route-level mocks: the handler only needs connections plus a usage fetcher.
const routeMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getUsageForProvider: vi.fn(),
}));
vi.mock("open-sse/index.js", () => ({}));
vi.mock("../../src/lib/localDb.js", () => ({
  getProviderConnections: routeMocks.getProviderConnections,
}));
vi.mock("open-sse/services/usage.js", () => ({
  getUsageForProvider: routeMocks.getUsageForProvider,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: async () => ({}),
}));
vi.mock("@/app/api/usage/[connectionId]/route.js", () => ({
  refreshAndUpdateCredentials: async (connection) => ({ connection }),
}));

const { GET } = await import("../../src/app/api/v1/usage/quota/route.js");

function antigravityUsage({ geminiSession, geminiWeekly, claudeSession, claudeWeekly }) {
  const withMeta = (quota, displayName) => ({
    ...quota,
    displayName,
    remainingPercentage: 100 - (quota.used / quota.total) * 100,
  });
  return {
    plan: "Pro",
    quotas: {
      gemini_session: withMeta(geminiSession, "Gemini (5h)"),
      gemini_weekly: withMeta(geminiWeekly, "Gemini (Weekly)"),
      claude_gpt_session: withMeta(claudeSession, "Claude & GPT (5h)"),
      claude_gpt_weekly: withMeta(claudeWeekly, "Claude & GPT (Weekly)"),
    },
  };
}

function flatQuota(used, total, resetAt) {
  return { used, total, resetAt };
}

const antigravityConnection = (id, extra = {}) => ({
  id,
  provider: "antigravity",
  authType: "oauth",
  isActive: true,
  email: `${id}@example.test`,
  ...extra,
});

describe("t3Quota", () => {
  it("filters out inactive and unsupported connections", () => {
    expect(isQuotaEligibleConnection({ id: "1", provider: "commandcode", authType: "apikey", isActive: true })).toBe(true);
    expect(isQuotaEligibleConnection({ id: "2", provider: "commandcode", authType: "apikey", isActive: false })).toBe(false);
    expect(isQuotaEligibleConnection({ id: "3", provider: "openai", authType: "apikey", isActive: true })).toBe(false);
    expect(isQuotaEligibleConnection({ id: "4", provider: "codex", authType: "oauth", isActive: true })).toBe(true);
  });

  it("maps commandcode quotas to one account with weighted percentages and no account tag", () => {
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
      id: "quota-commandcode-conn_1",
      label: "Command Code",
      windows: [
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
          usedPercent: 28.57,
          resetsAt: "2026-09-20T00:00:00.000Z",
        },
        {
          id: "credits",
          kind: "monthly",
          label: "Credits",
          usedPercent: 80,
          resetsAt: "2026-10-01T00:00:00.000Z",
        },
      ],
    });
  });

  it("aggregates three Antigravity connections into one account with one row per window", async () => {
    const fetcher = vi.fn(async (conn) => {
      if (conn.id === "ag1") {
        return antigravityUsage({
          geminiSession: flatQuota(100, 1000, "2026-11-27T10:00:00.000Z"),
          geminiWeekly: flatQuota(200, 1000, "2026-12-01T00:00:00.000Z"),
          claudeSession: flatQuota(100, 1000, "2026-11-27T11:00:00.000Z"),
          claudeWeekly: flatQuota(400, 1000, "2026-12-02T00:00:00.000Z"),
        });
      }
      if (conn.id === "ag2") {
        return antigravityUsage({
          geminiSession: flatQuota(200, 1000, "2026-11-27T09:00:00.000Z"),
          geminiWeekly: flatQuota(300, 1000, "2026-12-03T00:00:00.000Z"),
          claudeSession: flatQuota(200, 1000, "2026-11-27T12:00:00.000Z"),
          claudeWeekly: flatQuota(500, 1000, "2026-12-04T00:00:00.000Z"),
        });
      }
      return antigravityUsage({
        geminiSession: flatQuota(300, 1000, "2026-11-27T08:00:00.000Z"),
        geminiWeekly: flatQuota(400, 1000, "2026-12-05T00:00:00.000Z"),
        claudeSession: flatQuota(300, 1000, "2026-11-27T13:00:00.000Z"),
        claudeWeekly: flatQuota(600, 1000, "2026-12-06T00:00:00.000Z"),
      });
    });

    const connections = [
      antigravityConnection("ag1"),
      antigravityConnection("ag2"),
      antigravityConnection("ag3"),
    ];
    const result = await buildT3QuotaResponse(connections, fetcher);

    expect(result.version).toBe(1);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].id).toBe("quota-antigravity");
    expect(result.accounts[0].label).toBe("Antigravity");
    expect(result.accounts[0].windows).toHaveLength(4);

    const byId = Object.fromEntries(result.accounts[0].windows.map((w) => [w.id, w]));
    expect(byId.gemini_session).toEqual({
      id: "gemini_session",
      kind: "session",
      label: "Gemini (5h)",
      usedPercent: 20,
      resetsAt: "2026-11-27T08:00:00.000Z",
    });
    expect(byId.claude_gpt_session).toEqual({
      id: "claude_gpt_session",
      kind: "session",
      label: "Claude & GPT (5h)",
      usedPercent: 20,
      resetsAt: "2026-11-27T11:00:00.000Z",
    });
    expect(byId.gemini_weekly.usedPercent).toBe(30);
    expect(byId.claude_gpt_weekly.usedPercent).toBe(50);
  });

  it("aggregates two CodeBuddy CN connections into one monthly window", async () => {
    const fetcher = vi.fn(async (conn) => ({
      plan: "CodeBuddy",
      quotas: {
        Monthly: {
          used: conn.id === "cb1" ? 100 : 50,
          total: conn.id === "cb1" ? 400 : 600,
          resetAt: conn.id === "cb1" ? "2026-12-01T00:00:00.000Z" : "2026-12-02T00:00:00.000Z",
          recurring: true,
        },
      },
    }));

    const result = await buildT3QuotaResponse(
      [
        { id: "cb1", provider: "codebuddy-cn", authType: "oauth", isActive: true },
        { id: "cb2", provider: "codebuddy-cn", authType: "oauth", isActive: true },
      ],
      fetcher,
    );

    expect(result.accounts).toEqual([
      {
        id: "quota-codebuddy-cn",
        label: "CodeBuddy CN",
        windows: [
          {
            id: "monthly",
            kind: "monthly",
            label: "Monthly",
            usedPercent: 15,
            resetsAt: "2026-12-01T00:00:00.000Z",
          },
        ],
      },
    ]);
  });

  it("weights absolutes instead of averaging percentages across mixed allowances", async () => {
    const fetcher = vi.fn(async (conn) => ({
      quotas: {
        session: {
          used: conn.id === "small" ? 1 : 0,
          total: conn.id === "small" ? 1 : 10,
          resetAt: "2026-11-27T10:00:00.000Z",
        },
      },
    }));

    const result = await buildT3QuotaResponse(
      [
        { id: "small", provider: "codex", authType: "oauth", isActive: true },
        { id: "big", provider: "codex", authType: "oauth", isActive: true },
      ],
      fetcher,
    );

    expect(result.accounts[0].windows[0].usedPercent).toBe(9.09);
  });

  it("falls back to the mean for a pool with no used/total at all", async () => {
    const fetcher = vi.fn(async (conn) => ({
      quotas: { session: { remaining: conn.id === "c1" ? 70 : 90 } },
    }));

    const result = await buildT3QuotaResponse(
      [
        { id: "c1", provider: "codex", authType: "oauth", isActive: true },
        { id: "c2", provider: "codex", authType: "oauth", isActive: true },
      ],
      fetcher,
    );

    expect(result.accounts).toEqual([
      {
        id: "quota-codex",
        label: "OpenAI Codex",
        windows: [{ id: "5h", kind: "session", label: "5h", usedPercent: 20 }],
      },
    ]);
  });

  it("marks a mixed pool as approximate and weights only the absolute contributors", async () => {
    const fetcher = vi.fn(async (conn) =>
      conn.id === "abs"
        ? { quotas: { session: { used: 25, total: 100, resetAt: "2026-11-27T10:00:00.000Z" } } }
        : { quotas: { session: { remaining: 50 } } },
    );

    const result = await buildT3QuotaResponse(
      [
        { id: "abs", provider: "codex", authType: "oauth", isActive: true },
        { id: "pct", provider: "codex", authType: "oauth", isActive: true },
      ],
      fetcher,
    );

    expect(result.accounts[0].windows[0]).toEqual({
      id: "5h",
      kind: "session",
      label: "5h~",
      usedPercent: 25,
      resetsAt: "2026-11-27T10:00:00.000Z",
    });
  });

  it("keeps a provider whose connections are all percentage-only", async () => {
    const fetcher = vi.fn(async () => ({ quotas: { session: { remaining: 40 } } }));

    const result = await buildT3QuotaResponse(
      [
        { id: "p1", provider: "codex", authType: "oauth", isActive: true },
        { id: "p2", provider: "codex", authType: "oauth", isActive: true },
      ],
      fetcher,
    );

    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].windows).toEqual([
      { id: "5h", kind: "session", label: "5h", usedPercent: 60 },
    ]);
  });

  it("takes the earliest reset only among contributors that used quota", async () => {
    const fetcher = vi.fn(async (conn) => ({
      quotas: {
        session: {
          used: conn.id === "idle" ? 0 : 10,
          total: 100,
          resetAt: conn.id === "idle" ? "2026-01-01T00:00:00.000Z" : "2026-11-27T10:00:00.000Z",
        },
      },
    }));

    const result = await buildT3QuotaResponse(
      [
        { id: "idle", provider: "codex", authType: "oauth", isActive: true },
        { id: "hot", provider: "codex", authType: "oauth", isActive: true },
      ],
      fetcher,
    );

    expect(result.accounts[0].windows[0].resetsAt).toBe("2026-11-27T10:00:00.000Z");
  });

  it("omits resetsAt when no contributor has a finite reset", async () => {
    const fetcher = vi.fn(async () => ({ quotas: { session: { used: 5, total: 10 } } }));

    const result = await buildT3QuotaResponse(
      [{ id: "n1", provider: "codex", authType: "oauth", isActive: true }],
      fetcher,
    );

    expect(result.accounts[0].windows[0]).not.toHaveProperty("resetsAt");
  });

  it("orders windows deterministically regardless of connection order", async () => {
    const fetcher = vi.fn(async () => ({
      quotas: {
        Monthly: { used: 10, total: 100 },
        Weekly: { used: 20, total: 100 },
        "Session (5h)": { used: 30, total: 100 },
        Bonus: { used: 40, total: 100 },
      },
    }));

    const forward = await buildT3QuotaResponse(
      [
        { id: "a", provider: "commandcode", authType: "apikey", isActive: true },
        { id: "b", provider: "commandcode", authType: "apikey", isActive: true },
      ],
      fetcher,
    );
    const reversed = await buildT3QuotaResponse(
      [
        { id: "b", provider: "commandcode", authType: "apikey", isActive: true },
        { id: "a", provider: "commandcode", authType: "apikey", isActive: true },
      ],
      fetcher,
    );

    expect(forward).toEqual(reversed);
    expect(forward.accounts[0].windows.map((w) => w.kind)).toEqual([
      "session",
      "weekly",
      "monthly",
      "other",
    ]);
    expect(forward.accounts[0].windows.map((w) => w.id)).toEqual([
      "session-5h",
      "weekly",
      "monthly",
      "bonus",
    ]);
  });

  it("keeps ids unique per window and derives them from the registry id", async () => {
    const account = mapUsageToT3QuotaAccount(antigravityConnection("ag1"), antigravityUsage({
      geminiSession: flatQuota(100, 1000, null),
      geminiWeekly: flatQuota(200, 1000, null),
      claudeSession: flatQuota(300, 1000, null),
      claudeWeekly: flatQuota(400, 1000, null),
    }));

    expect(account.id).toBe("quota-antigravity-ag1");
    expect(account.label).toBe("Antigravity");
    expect(account.label).not.toContain("@");
    const ids = account.windows.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reports served/total connections in the label only when some failed", async () => {
    const fetcher = vi.fn(async (conn) => {
      if (conn.id === "bad") throw new Error("timeout");
      return { quotas: { session: { used: 25, total: 100 } } };
    });

    const degraded = await buildT3QuotaResponse(
      [
        { id: "bad", provider: "codex", authType: "oauth", isActive: true },
        { id: "ok", provider: "codex", authType: "oauth", isActive: true },
      ],
      fetcher,
    );
    expect(degraded.accounts[0].label).toBe("OpenAI Codex (1/2)");

    const healthy = await buildT3QuotaResponse(
      [{ id: "ok", provider: "codex", authType: "oauth", isActive: true }],
      fetcher,
    );
    expect(healthy.accounts[0].label).toBe("OpenAI Codex");
  });

  it("honours the group=none option with one account per connection", async () => {
    const fetcher = vi.fn(async (conn) => ({
      quotas: { session: { used: 10, total: 100, resetAt: "2026-11-27T10:00:00.000Z" } },
    }));

    const result = await buildT3QuotaResponse(
      [
        antigravityConnection("ag1"),
        antigravityConnection("ag2"),
        antigravityConnection("ag3"),
      ],
      fetcher,
      { group: "none" },
    );

    expect(result.accounts.map((a) => a.id)).toEqual([
      "quota-antigravity-ag1",
      "quota-antigravity-ag2",
      "quota-antigravity-ag3",
    ]);
    expect(result.accounts.every((a) => a.windows.length === 1)).toBe(true);
  });

  it("fetches connections in batches of at most six by default", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetcher = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { quotas: { session: { used: 1, total: 100 } } };
    });

    const connections = Array.from({ length: 14 }, (_, i) => ({
      id: `c${i}`,
      provider: "codex",
      authType: "oauth",
      isActive: true,
    }));
    await buildT3QuotaResponse(connections, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(14);
    expect(peak).toBeLessThanOrEqual(6);
  });

  it("serves aggregated accounts by default and per-connection accounts for ?group=none", async () => {
    routeMocks.getProviderConnections.mockResolvedValue([
      antigravityConnection("ag1"),
      antigravityConnection("ag2"),
    ]);
    routeMocks.getUsageForProvider.mockResolvedValue({
      quotas: { gemini_session: { used: 100, total: 1000, remainingPercentage: 90 } },
    });

    const aggregated = await (await GET(new Request("http://localhost/v1/usage/quota"))).json();
    expect(aggregated.accounts.map((a) => a.id)).toEqual(["quota-antigravity"]);

    const perConnection = await (
      await GET(new Request("http://localhost/v1/usage/quota?group=none"))
    ).json();
    expect(perConnection.accounts.map((a) => a.id)).toEqual([
      "quota-antigravity-ag1",
      "quota-antigravity-ag2",
    ]);
  });
});
