import "open-sse/index.js";

import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { refreshAndUpdateCredentials } from "@/app/api/usage/[connectionId]/route.js";
import { buildT3QuotaResponse } from "@/lib/usage/t3Quota.js";

export const dynamic = "force-dynamic";

const AUTH_EXPIRED_PATTERNS = ["expired", "authentication", "unauthorized", "401", "re-authorize"];

function isAuthExpiredMessage(usage) {
  if (!usage?.message) return false;
  const msg = usage.message.toLowerCase();
  return AUTH_EXPIRED_PATTERNS.some((pattern) => msg.includes(pattern));
}

async function fetchUsageForConnection(connection) {
  const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData);
  const proxyOptions = {
    connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
    connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
    connectionNoProxy: proxyConfig.connectionNoProxy || "",
    vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
    strictProxy: false,
  };

  let activeConn = connection;
  const isOAuth = activeConn.authType === "oauth";
  if (isOAuth) {
    const refreshed = await refreshAndUpdateCredentials(activeConn, false, proxyOptions);
    activeConn = refreshed.connection;
  }

  let usage = await getUsageForProvider(activeConn, proxyOptions);
  if (isOAuth && isAuthExpiredMessage(usage) && activeConn.refreshToken) {
    const retried = await refreshAndUpdateCredentials(activeConn, true, proxyOptions);
    activeConn = retried.connection;
    usage = await getUsageForProvider(activeConn, proxyOptions);
  }
  return usage;
}

/**
 * GET /api/v1/usage/quota (rewritten from /v1/usage/quota)
 * Returns T3 Code HttpQuotaResponse ({ version: 1, accounts }) for active quota-capable connections.
 */
export async function GET() {
  try {
    const connections = await getProviderConnections();
    const payload = await buildT3QuotaResponse(connections, fetchUsageForConnection);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.warn("[API] Failed to build T3 quota response:", error);
    return NextResponse.json({ error: "Failed to fetch quota" }, { status: 500 });
  }
}
