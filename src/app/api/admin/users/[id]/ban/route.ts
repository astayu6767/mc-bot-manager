import { db } from "@/db";
import { users, bots } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { stopBot } from "@/lib/botManager";
import { addIpBan, listIpBans, removeIpBan } from "@/lib/ipBans";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Site ban — the non-destructive hammer. Banned users can't access anything:
// middleware blocks every page and API route for them ("You are banned by
// the owner."). Their bots are stopped but NOTHING is deleted — keys,
// licenses, bots and settings all stay intact and come back on unban.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (id === me.id) {
    return Response.json(
      { error: "You can't ban your own account" },
      { status: 400 },
    );
  }

  let body: { banned?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  if (typeof body.banned !== "boolean") {
    return Response.json(
      { error: "Body needs { banned: true | false }" },
      { status: 400 },
    );
  }

  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  await db
    .update(users)
    .set({ banned: body.banned ? "true" : "false" })
    .where(eq(users.id, id));

  let stopped = 0;
  let ipBanned = false;
  if (body.banned) {
    // Stop their running bots (no deletes — everything survives the ban).
    const owned = await db.select().from(bots).where(eq(bots.userId, id));
    for (const b of owned) {
      try {
        await stopBot(b.id);
        stopped++;
      } catch (err) {
        console.warn(
          `[site-ban] stopBot failed for ${b.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    // Wall off their last known IP too — otherwise they just log out and
    // register a fresh account from the same machine. The middleware's IP
    // ban guard blocks EVERY route for that IP (pages + register + API).
    if (user.lastIp) {
      try {
        await addIpBan({
          ip: user.lastIp,
          reason: `Site ban of "${user.username}"`,
          bannedBy: me.username,
        });
        ipBanned = true;
      } catch (err) {
        console.warn(
          `[site-ban] IP ban failed for ${user.lastIp}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    console.warn(
      `[admin] ${me.username} site-banned "${user.username}" — ${stopped} bot(s) stopped, IP ${ipBanned ? "banned" : "not on record"}, nothing deleted`,
    );
  } else {
    // Unban: also lift the IP ban that came WITH this site ban — but never
    // touch IP bans an admin added manually for other reasons.
    if (user.lastIp) {
      try {
        const marker = `Site ban of "${user.username}"`;
        const existing = (await listIpBans()).find(
          (b) => b.ip === user.lastIp && b.reason === marker,
        );
        if (existing) {
          await removeIpBan(existing.ip);
          ipBanned = true; // reports "IP unbanned" below
        }
      } catch (err) {
        console.warn(
          `[site-unban] IP unban failed for ${user.lastIp}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    console.warn(`[admin] ${me.username} unbanned "${user.username}"`);
  }

  return Response.json({
    ok: true,
    banned: body.banned,
    stopped,
    ipBanned,
    note:
      body.banned && !user.lastIp
        ? "No IP on record — they can still register from the same IP. Use Blacklist after they log in once."
        : undefined,
  });
}
