import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

// Site-banned user IDs — cached for 60s so the middleware can enforce the
// ban on every request without a database hit. Same fail-open pattern as
// the IP ban list (a DB hiccup must never take the whole site down).

const REFRESH_MS = 60 * 1000;

const globalForBans = globalThis as typeof globalThis & {
  __mcbmBannedUserIds?: Set<string>;
  __mcbmBannedUsersFetchedAt?: number;
  __mcbmBannedUsersRefreshing?: boolean;
};

async function refresh(): Promise<void> {
  if (globalForBans.__mcbmBannedUsersRefreshing) return;
  globalForBans.__mcbmBannedUsersRefreshing = true;
  try {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.banned, "true"));
    globalForBans.__mcbmBannedUserIds = new Set(rows.map((r) => r.id));
    globalForBans.__mcbmBannedUsersFetchedAt = Date.now();
  } catch (err) {
    console.warn(
      `[guard] banned-user refresh failed: ${err instanceof Error ? err.message : err}`,
    );
    if (!globalForBans.__mcbmBannedUsersFetchedAt) {
      globalForBans.__mcbmBannedUsersFetchedAt = Date.now();
    }
  } finally {
    globalForBans.__mcbmBannedUsersRefreshing = false;
  }
}

export async function isUserBanned(userId: string): Promise<boolean> {
  const fetchedAt = globalForBans.__mcbmBannedUsersFetchedAt ?? 0;
  if (Date.now() - fetchedAt > REFRESH_MS) {
    await refresh();
  }
  return globalForBans.__mcbmBannedUserIds?.has(userId) ?? false;
}
