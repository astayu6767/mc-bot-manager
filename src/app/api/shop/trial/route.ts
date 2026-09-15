import { db } from "@/db";
import { licenses, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { createLicense } from "@/lib/license";
import { logDiscordEvent } from "@/lib/eventLog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Free trial — one per account, forever. Grants a 1-bot / 24-hour license
// instantly (no payment, no key to redeem). The "one per account" check is
// server-side on the license reason, which only this route can set.
const TRIAL_REASON = "Free trial";
const TRIAL_SLOTS = 1;
const TRIAL_HOURS = 24;

export async function POST() {
  const me = await getCurrentUser();
  if (!me) {
    return Response.json({ error: "Not logged in" }, { status: 401 });
  }

  // Ever claimed? (active, expired or held — a trial is a trial)
  const previous = await db
    .select({ id: licenses.id })
    .from(licenses)
    .where(and(eq(licenses.userId, me.id), eq(licenses.reason, TRIAL_REASON)))
    .limit(1);
  if (previous.length > 0) {
    return Response.json(
      { error: "You have already used your free trial" },
      { status: 409 },
    );
  }

  const [user] = await db.select().from(users).where(eq(users.id, me.id));
  if (!user) {
    return Response.json({ error: "Account not found" }, { status: 404 });
  }

  const license = await createLicense({
    userId: me.id,
    slots: TRIAL_SLOTS,
    durationDays: 0,
    durationHours: TRIAL_HOURS,
    reason: TRIAL_REASON,
  });

  console.warn(`[shop] ${me.username} claimed the free trial (1 bot / 24h)`);
  logDiscordEvent("purchase", {
    title: "Free trial claimed",
    color: 0x0ea5e9,
    fields: [
      { name: "User", value: me.username, inline: true },
      { name: "Grant", value: "1 bot · 24 hours", inline: true },
      { name: "Expires", value: new Date(license.expiresAt).toLocaleString(), inline: false },
    ],
  });

  return Response.json({
    ok: true,
    message: "Trial active — 1 bot for 24 hours",
    expiresAt: license.expiresAt,
  });
}
