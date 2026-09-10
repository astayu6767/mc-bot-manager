import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

// Client-IP helpers. Behind Railway's proxy the client IP arrives in
// X-Forwarded-For (first entry). Internal/private addresses are treated as
// "unknown" so proxy-internal IPs never get recorded or banned.

export function getClientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0].trim();
    if (first && !isPrivateIp(first)) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real && !isPrivateIp(real)) return real.trim();
  return null;
}

export function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  if (ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80")) return true;
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const [a, b] = parts.map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/** Remember the IP an account last logged in from (skips private IPs). */
export async function recordUserIp(userId: string, ip: string | null): Promise<void> {
  if (!ip) return;
  try {
    await db.update(users).set({ lastIp: ip }).where(eq(users.id, userId));
  } catch {
    // never block a login over IP bookkeeping
  }
}
