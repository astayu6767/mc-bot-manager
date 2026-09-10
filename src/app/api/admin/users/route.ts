import { db } from "@/db";
import { users, bots } from "@/db/schema";
import { desc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getRuntimeView } from "@/lib/botManager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));
  const allBots = await db.select().from(bots);

  const data = allUsers.map((u) => {
    const owned = allBots.filter((b) => b.userId === u.id);
    const online = owned.filter(
      (b) => getRuntimeView(b.id).status === "online",
    ).length;
    return {
      id: u.id,
      username: u.username,
      avatar: u.avatar,
      role: u.role,
      botSlots: u.botSlots,
      botCount: owned.length,
      botsOnline: online,
      isGuest: u.discordId?.startsWith("dev:") ?? false,
      discordId: u.discordId,
      lastIp: u.lastIp,
      hasPassword: u.passwordHash !== "",
      createdAt: u.createdAt,
    };
  });

  return Response.json({ users: data });
}
