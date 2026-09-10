import { db } from "@/db";
import { users, bots } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { stopBot } from "@/lib/botManager";
import { addIpBan } from "@/lib/ipBans";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Blacklist a user: ban their last known IP and delete the account with
// everything it owns (bots). If no IP was ever recorded, the account is
// still deleted and the response says so.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  if (id === me.id) {
    return Response.json(
      { error: "You can't blacklist your own account" },
      { status: 400 },
    );
  }

  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  // Stop their bots without letting one failure abort the whole blacklist.
  const owned = await db.select().from(bots).where(eq(bots.userId, id));
  for (const b of owned) {
    try {
      await stopBot(b.id);
    } catch (err) {
      console.warn(`[blacklist] stopBot failed for ${b.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  let bannedIp: string | null = null;
  if (user.lastIp) {
    try {
      await addIpBan({
        ip: user.lastIp,
        reason: `Blacklist of user "${user.username}"`,
        bannedBy: me.username,
      });
      bannedIp = user.lastIp;
    } catch (err) {
      console.warn(`[blacklist] IP ban failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  await db.delete(bots).where(eq(bots.userId, id));
  await db.delete(users).where(eq(users.id, id));

  return Response.json({
    ok: true,
    bannedIp,
    note: bannedIp
      ? `Account deleted and IP ${bannedIp} banned.`
      : "Account deleted. No IP was on record (the user never logged in since IP tracking was added).",
  });
}
