import { db } from "@/db";
import { users, bots } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { stopBot } from "@/lib/botManager";

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
    console.warn(
      `[admin] ${me.username} site-banned "${user.username}" — ${stopped} bot(s) stopped, nothing deleted`,
    );
  } else {
    console.warn(`[admin] ${me.username} unbanned "${user.username}"`);
  }

  return Response.json({ ok: true, banned: body.banned, stopped });
}
