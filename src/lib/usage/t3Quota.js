import {
  AI_PROVIDERS,
  USAGE_APIKEY_PROVIDERS,
  USAGE_SUPPORTED_PROVIDERS,
} from "@/shared/constants/providers";
import {
  getRemainingPercentage,
  parseQuotaData,
} from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";
import { isLeaseConnection } from "open-sse/services/minimaxCodeLease.js";

const WINDOW_KIND_ORDER = { session: 0, weekly: 1, monthly: 2 };
const OTHER_WINDOW_ORDER = 3;

function inferWindowKind(name) {
  const text = String(name || "").toLowerCase();
  if (/\b(5h|5-hour|5 hour|session)\b/.test(text)) return "session";
  if (/\b(weekly|7d|week)\b/.test(text)) return "weekly";
  if (/\b(monthly|credits?|month)\b/.test(text)) return "monthly";
  return "other";
}

function toWindowId(name, index, seen) {
  const base =
    String(name || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || `window-${index + 1}`;
  let candidate = base;
  let suffix = 2;
  while (seen.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  seen.add(candidate);
  return candidate;
}

function parseIsoReset(resetAt) {
  if (resetAt == null) return undefined;
  if (typeof resetAt === "number") {
    if (!Number.isFinite(resetAt) || resetAt <= 0) return undefined;
    const ms = resetAt < 1e12 ? resetAt * 1000 : resetAt;
    return new Date(ms).toISOString();
  }
  if (typeof resetAt === "string") {
    const trimmed = resetAt.trim();
    if (!trimmed) return undefined;
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) return parseIsoReset(asNumber);
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : undefined;
  }
  return undefined;
}

function hasMeasurableQuota(row) {
  if (!row || row.unlimited === true) return false;
  if (typeof row.percentage === "number" && Number.isFinite(row.percentage)) return true;
  if (typeof row.remaining === "number" && Number.isFinite(row.remaining)) return true;
  if (typeof row.remainingPercentage === "number" && Number.isFinite(row.remainingPercentage)) return true;
  return typeof row.total === "number" && Number.isFinite(row.total) && row.total > 0;
}

export function isQuotaEligibleConnection(connection) {
  if (!connection || connection.isActive === false) return false;
  if (connection.authType === "oauth") {
    return USAGE_SUPPORTED_PROVIDERS.includes(connection.provider);
  }
  if (connection.authType === "apikey" || connection.authType === "api_key") {
    return USAGE_APIKEY_PROVIDERS.includes(connection.provider);
  }
  return isLeaseConnection(connection);
}

function providerDisplayName(provider) {
  return AI_PROVIDERS[provider]?.name ?? provider;
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100;
}

function kindOrder(kind) {
  return WINDOW_KIND_ORDER[kind] ?? OTHER_WINDOW_ORDER;
}

// Aggregation works from absolutes; percentages are only a fallback for rows
// that carry no used/total at all.
function readAbsolutes(row) {
  const used = Number(row.used);
  const total = Number(row.total);
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
  return { used: Math.max(0, used), total };
}

function windowIdentity(row) {
  return String(row.modelKey || row.name || "").trim().toLowerCase();
}

function collectConnectionWindows(connection, usage) {
  if (!usage || typeof usage !== "object" || !usage.quotas) return [];
  const rows = parseQuotaData(connection.provider, usage);
  const windows = [];

  for (const [index, row] of rows.entries()) {
    if (!hasMeasurableQuota(row)) continue;
    const remainingPercent = getRemainingPercentage(row);
    if (!Number.isFinite(remainingPercent)) continue;
    const absolutes = readAbsolutes(row);
    const label = String(row.name || row.modelKey || `Window ${index + 1}`).trim();
    const identity = windowIdentity(row) || `window-${index + 1}`;
    windows.push({
      identity,
      kind: inferWindowKind(`${label} ${identity.replace(/[_.-]+/g, " ")}`),
      label,
      usedPercent: clampPercent(
        absolutes ? (absolutes.used / absolutes.total) * 100 : 100 - remainingPercent,
      ),
      absolutes,
      resetsAt: parseIsoReset(row.resetAt),
    });
  }

  return windows;
}

function weightedPercent(windows) {
  let used = 0;
  let total = 0;
  for (const window of windows) {
    used += window.absolutes.used;
    total += window.absolutes.total;
  }
  return total > 0 ? (used / total) * 100 : 0;
}

// An idle account's reset says nothing about when the pool recovers, so only
// contributors that actually consumed quota may supply the earliest reset.
function earliestActiveReset(contributors) {
  let earliest = null;
  for (const contributor of contributors) {
    if (!contributor.resetsAt) continue;
    const isActive = contributor.absolutes
      ? contributor.absolutes.used > 0
      : contributor.usedPercent > 0;
    if (!isActive) continue;
    const ms = Date.parse(contributor.resetsAt);
    if (!Number.isFinite(ms)) continue;
    if (earliest === null || ms < earliest.ms) {
      earliest = { ms, iso: contributor.resetsAt };
    }
  }
  return earliest?.iso;
}

function representativeLabel(contributors) {
  return [...contributors].sort((a, b) => a.label.localeCompare(b.label))[0];
}

function aggregateProviderWindows(connectionWindows) {
  const groups = new Map();
  for (const windows of connectionWindows) {
    for (const window of windows) {
      if (!groups.has(window.identity)) groups.set(window.identity, []);
      groups.get(window.identity).push(window);
    }
  }

  const pooled = [];
  for (const [identity, contributors] of groups) {
    const absolute = contributors.filter((window) => window.absolutes);
    const percentageOnly = contributors.filter((window) => !window.absolutes);
    let usedPercent;
    let approximate = false;

    if (percentageOnly.length === 0) {
      usedPercent = weightedPercent(absolute);
    } else if (absolute.length === 0) {
      // No contributor reports used/total: the mean is exact only when the
      // allowances are equal, which is the best available assumption here.
      usedPercent =
        percentageOnly.reduce((sum, window) => sum + window.usedPercent, 0) /
        percentageOnly.length;
    } else {
      // Mixed pool: weight the absolute contributors only, so the number is
      // approximate and the label says so.
      usedPercent = weightedPercent(absolute);
      approximate = true;
    }

    const representative = representativeLabel(contributors);
    pooled.push({
      identity,
      kind: representative.kind,
      label: approximate ? `${representative.label}~` : representative.label,
      usedPercent: clampPercent(usedPercent),
      resetsAt: earliestActiveReset(contributors),
    });
  }

  const seenIds = new Set();
  const windows = pooled.map((window, index) => ({
    id: toWindowId(window.identity, index, seenIds),
    kind: window.kind,
    label: window.label,
    usedPercent: window.usedPercent,
    ...(window.resetsAt ? { resetsAt: window.resetsAt } : {}),
  }));

  return windows.sort(
    (a, b) => kindOrder(a.kind) - kindOrder(b.kind) || a.id.localeCompare(b.id),
  );
}

function mapConnectionWindowsToAccount(connection, collected) {
  if (collected.length === 0) return null;

  const seenIds = new Set();
  const windows = collected.map((window, index) => ({
    id: toWindowId(window.identity, index, seenIds),
    kind: window.kind,
    label: window.label,
    usedPercent: clampPercent(window.usedPercent),
    ...(window.resetsAt ? { resetsAt: window.resetsAt } : {}),
  }));

  return {
    id: `quota-${connection.provider}-${connection.id}`,
    label: providerDisplayName(connection.provider),
    windows: windows.sort(
      (a, b) => kindOrder(a.kind) - kindOrder(b.kind) || a.id.localeCompare(b.id),
    ),
  };
}

export function mapUsageToT3QuotaAccount(connection, usage) {
  return mapConnectionWindowsToAccount(connection, collectConnectionWindows(connection, usage));
}

export async function buildT3QuotaResponse(connections, fetchUsageForConnection, options = {}) {
  const { concurrency = 6, group = "provider" } =
    typeof options === "number" ? { concurrency: options } : options;
  const eligible = connections.filter(isQuotaEligibleConnection);
  const windowsByIndex = new Map();

  for (let i = 0; i < eligible.length; i += concurrency) {
    const batch = eligible.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async (connection, offset) => {
        const usage = await fetchUsageForConnection(connection);
        return { index: i + offset, windows: collectConnectionWindows(connection, usage) };
      }),
    );
    for (const result of settled) {
      if (result.status === "fulfilled") {
        windowsByIndex.set(result.value.index, result.value.windows);
      }
    }
  }

  if (group === "none") {
    const accounts = eligible
      .map((connection, index) =>
        mapConnectionWindowsToAccount(connection, windowsByIndex.get(index) || []),
      )
      .filter(Boolean);
    return { version: 1, accounts };
  }

  const byProvider = new Map();
  for (const [index, connection] of eligible.entries()) {
    if (!byProvider.has(connection.provider)) byProvider.set(connection.provider, []);
    byProvider.get(connection.provider).push(windowsByIndex.get(index) || []);
  }

  const accounts = [];
  for (const [provider, providerWindows] of byProvider) {
    const windows = aggregateProviderWindows(providerWindows);
    if (windows.length === 0) continue;
    // A percentage-only provider is kept (its windows still aggregate), but a
    // provider whose every fetch failed has nothing to render at all.
    const served = providerWindows.filter((entry) => entry.length > 0).length;
    const name = providerDisplayName(provider);
    accounts.push({
      id: `quota-${provider}`,
      label: served < providerWindows.length ? `${name} (${served}/${providerWindows.length})` : name,
      windows,
    });
  }

  accounts.sort((a, b) => a.id.localeCompare(b.id));

  return { version: 1, accounts };
}
