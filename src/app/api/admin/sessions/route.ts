import { db } from "@/db";
import { users, bots } from "@/db/schema";
import { desc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getRuntimeView } from "@/lib/botManager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Admin: every bot's session ID in one place — who owns it, which account
// it is, where it's connected and whether it's live right now.
export async function GET() {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const allUsers = await db.select().from(users);
  const nameOf = new Map(allUsers.map((u) => [u.id, u.username]));
  const allBots = await db.select().from(bots).orderBy(desc(bots.createdAt));

  const data = allBots.map((b) => ({
    id: b.id,
    name: b.name,
    username: b.username, // the minecraft IGN once resolved
    token: b.token, // the session ID the user pasted
    host: b.host,
    port: b.port,
    engine: b.engine,
    beamType: b.beamType,
    status: getRuntimeView(b.id).status,
    owner: nameOf.get(b.userId ?? "") ?? "unknown",
    createdAt: b.createdAt,
  }));

  return Response.json({ sessions: data });
}
