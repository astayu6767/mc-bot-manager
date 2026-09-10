import { db } from "@/db";
import { ipBans } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

// IP ban management shared by the admin API and the middleware cache.

export type IpBan = {
  id: string;
  ip: string;
  reason: string;
  bannedBy: string;
  createdAt: Date;
};

export async function listIpBans(): Promise<IpBan[]> {
  return db.select().from(ipBans).orderBy(desc(ipBans.createdAt));
}

export async function addIpBan(params: {
  ip: string;
  reason?: string;
  bannedBy?: string;
}): Promise<IpBan> {
  const ip = params.ip.trim();
  if (!ip || ip.length < 3) throw new Error("Invalid IP");
  const [existing] = await db.select().from(ipBans).where(eq(ipBans.ip, ip));
  if (existing) return existing;
  const [ban] = await db
    .insert(ipBans)
    .values({ ip, reason: params.reason || "", bannedBy: params.bannedBy || "" })
    .returning();
  return ban;
}

export async function removeIpBan(ip: string): Promise<boolean> {
  const removed = await db.delete(ipBans).where(eq(ipBans.ip, ip)).returning();
  return removed.length > 0;
}

export async function getBannedIps(): Promise<Set<string>> {
  const rows = await db.select({ ip: ipBans.ip }).from(ipBans);
  return new Set(rows.map((r) => r.ip));
}
