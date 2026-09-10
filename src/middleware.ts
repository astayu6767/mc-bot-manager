import { NextResponse, type NextRequest } from "next/server";
import { getBannedIps } from "@/lib/ipBans";
import { isPrivateIp } from "@/lib/ip";

// Edge of the app: every request passes through here.
//  1. Banned IPs (admin blacklist) are refused everywhere.
//  2. VPN / proxy connections are refused (toggle with BLOCK_VPN=0 to off;
//     exempt specific IPs with the VPN_ALLOWLIST env, comma-separated).

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};

// ---------------------------------------------------------------------------
// Ban cache — refreshed from the DB every 60s so enforcement is near-live
// without a database hit on every request.
// ---------------------------------------------------------------------------

const globalForGuard = globalThis as typeof globalThis & {
  __mcbmBannedIps?: Set<string>;
  __mcbmBansFetchedAt?: number;
  __mcbmBansRefreshing?: boolean;
  __mcbmVpnCache?: Map<string, { proxy: boolean; at: number }>;
};

const BAN_REFRESH_MS = 60 * 1000;
const VPN_CACHE_MS = 60 * 60 * 1000; // 1h per IP verdict

async function refreshBans(): Promise<void> {
  if (globalForGuard.__mcbmBansRefreshing) return;
  globalForGuard.__mcbmBansRefreshing = true;
  try {
    globalForGuard.__mcbmBannedIps = await getBannedIps();
    globalForGuard.__mcbmBansFetchedAt = Date.now();
  } catch (err) {
    // DB unavailable — fail open, keep any previous list.
    console.warn(`[guard] ban refresh failed: ${err instanceof Error ? err.message : err}`);
    if (!globalForGuard.__mcbmBansFetchedAt) globalForGuard.__mcbmBansFetchedAt = Date.now();
  } finally {
    globalForGuard.__mcbmBansRefreshing = false;
  }
}

function startBanRefreshLoop(): void {
  const g = globalThis as typeof globalThis & { __mcbmBanTimer?: ReturnType<typeof setInterval> };
  if (g.__mcbmBanTimer) return;
  g.__mcbmBanTimer = setInterval(() => void refreshBans(), BAN_REFRESH_MS);
}

async function isBanned(ip: string): Promise<boolean> {
  const fetchedAt = globalForGuard.__mcbmBansFetchedAt ?? 0;
  if (Date.now() - fetchedAt > BAN_REFRESH_MS) {
    await refreshBans();
    startBanRefreshLoop();
  } else {
    startBanRefreshLoop();
  }
  return globalForGuard.__mcbmBannedIps?.has(ip) ?? false;
}

// ---------------------------------------------------------------------------
// VPN / proxy detection via proxycheck.io (free tier; add PROXYCHECK_KEY for
// a higher quota). Verdicts are cached for an hour per IP.
// ---------------------------------------------------------------------------

async function checkVpn(ip: string): Promise<boolean> {
  if (!globalForGuard.__mcbmVpnCache) globalForGuard.__mcbmVpnCache = new Map();
  const cached = globalForGuard.__mcbmVpnCache.get(ip);
  if (cached && Date.now() - cached.at < VPN_CACHE_MS) return cached.proxy;

  let proxy = false;
  try {
    const key = process.env.PROXYCHECK_KEY ? `&key=${process.env.PROXYCHECK_KEY}` : "";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://proxycheck.io/v2/${ip}?vpn=1&asn=1${key}`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as Record<string, any>;
      const info = (data?.[ip] ?? data) as Record<string, any> | undefined;
      proxy = info?.proxy === "yes";
    }
  } catch (err) {
    // Detector unreachable — fail open (never take the whole site down).
    console.warn(`[guard] vpn check failed for ${ip}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
  globalForGuard.__mcbmVpnCache.set(ip, { proxy, at: Date.now() });
  return proxy;
}

// ---------------------------------------------------------------------------
// Blocked responses
// ---------------------------------------------------------------------------

const PAGE_CSS = `
  * { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         background: #030712; color: #e2e8f0; }
  .card { max-width: 420px; padding: 48px 40px; text-align: center; }
  h1 { font-size: 20px; margin: 18px 0 8px; color: #fff; }
  p { font-size: 14px; line-height: 1.6; color: #94a3b8; margin: 0; }
  .dot { width: 14px; height: 14px; border-radius: 999px; margin: 0 auto;
         box-shadow: 0 0 24px -4px currentColor; }
`;

function blockedPage(opts: { color: string; title: string; body: string }): Response {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${opts.title}</title><style>${PAGE_CSS}</style></head><body><div class="card"><div class="dot" style="background:${opts.color};color:${opts.color}"></div><h1>${opts.title}</h1><p>${opts.body}</p></div></body></html>`;
  return new Response(html, { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function blockedJson(message: string): Response {
  return NextResponse.json({ error: message }, { status: 403 });
}

// ---------------------------------------------------------------------------

export async function middleware(req: NextRequest) {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip")?.trim() ?? "";
  if (!ip || isPrivateIp(ip)) return NextResponse.next();

  if (await isBanned(ip)) {
    if (req.nextUrl.pathname.startsWith("/api")) {
      return blockedJson("Your IP address has been banned.");
    }
    return blockedPage({
      color: "#f43f5e",
      title: "Access denied",
      body: "Your IP address has been banned from this service.",
    });
  }

  if (process.env.BLOCK_VPN !== "0") {
    const allow = (process.env.VPN_ALLOWLIST || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!allow.includes(ip) && (await checkVpn(ip))) {
      if (req.nextUrl.pathname.startsWith("/api")) {
        return blockedJson("VPN and proxy connections are not allowed. Disable your VPN and try again.");
      }
      return blockedPage({
        color: "#f59e0b",
        title: "VPN detected",
        body: "VPN and proxy connections are not allowed here. Disable your VPN and reload the page.",
      });
    }
  }

  return NextResponse.next();
}
