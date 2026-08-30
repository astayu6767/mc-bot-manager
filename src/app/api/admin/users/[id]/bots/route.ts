import { db } from "@/db";
import { bots } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getRuntimeView } from "@/lib/botManager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const rows = await db
    .select()
    .from(bots)
    .where(eq(bots.userId, id))
    .orderBy(desc(bots.createdAt));
  const data = rows.map((b) => {
    const rt = getRuntimeView(b.id);
    return {
      id: b.id,
      name: b.name,
      username: b.username,
      host: b.host,
      port: b.port,
      version: b.version,
      engine: b.engine,
      status: rt.status,
    };
  });
  return Response.json({ bots: data });
}
