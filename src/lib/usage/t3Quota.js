import {
  AI_PROVIDERS,
  USAGE_APIKEY_PROVIDERS,
  USAGE_SUPPORTED_PROVIDERS,
} from "@/shared/constants/providers";
import {
  getConnectionLabel,
  getRemainingPercentage,
  parseQuotaData,
} from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";
import { isLeaseConnection } from "open-sse/services/minimaxCodeLease.js";

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

export function mapUsageToT3QuotaAccount(connection, usage) {
  if (!usage || typeof usage !== "object" || !usage.quotas) return null;
  const rows = parseQuotaData(connection.provider, usage);
  const seenIds = new Set();
  const windows = [];

  for (const [index, row] of rows.entries()) {
    if (!hasMeasurableQuota(row)) continue;
    const remainingPercent = getRemainingPercentage(row);
    if (!Number.isFinite(remainingPercent)) continue;
    const usedPercent = Math.round(Math.min(100, Math.max(0, 100 - remainingPercent)) * 100) / 100;
    const resetsAt = parseIsoReset(row.resetAt);
    const label = String(row.name || row.modelKey || `Window ${index + 1}`).trim();
    windows.push({
      id: toWindowId(row.modelKey || label, index, seenIds),
      kind: inferWindowKind(label),
      label,
      usedPercent,
      ...(resetsAt ? { resetsAt } : {}),
    });
  }

  if (windows.length === 0) return null;

  const providerName = AI_PROVIDERS[connection.provider]?.name || connection.provider;
  const accountTag =
    getConnectionLabel(connection) ||
    (typeof usage.plan === "string" && usage.plan.trim()) ||
    String(connection.id).slice(0, 6);

  return {
    id: `9router-${connection.provider}-${connection.id}`,
    label: `${providerName} (${accountTag})`,
    windows,
  };
}

export async function buildT3QuotaResponse(connections, fetchUsageForConnection, concurrency = 6) {
  const eligible = connections.filter(isQuotaEligibleConnection);
  const accounts = [];

  for (let i = 0; i < eligible.length; i += concurrency) {
    const batch = eligible.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async (conn) => {
        const usage = await fetchUsageForConnection(conn);
        return mapUsageToT3QuotaAccount(conn, usage);
      }),
    );
    for (const result of settled) {
      if (result.status === "fulfilled" && result.value) {
        accounts.push(result.value);
      }
    }
  }

  return { version: 1, accounts };
}
