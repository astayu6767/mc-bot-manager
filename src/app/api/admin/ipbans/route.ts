import { getCurrentUser } from "@/lib/auth";
import { addIpBan, listIpBans, removeIpBan } from "@/lib/ipBans";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const bans = await listIpBans();
  return Response.json({ bans });
}

export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const { ip, reason } = body;
    if (!ip || typeof ip !== "string") {
      return Response.json({ error: "IP required" }, { status: 400 });
    }
    const ban = await addIpBan({ ip, reason, bannedBy: me.username });
    return Response.json({ ban });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to ban IP" },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const ip = new URL(req.url).searchParams.get("ip");
  if (!ip) return Response.json({ error: "ip query param required" }, { status: 400 });
  const removed = await removeIpBan(ip);
  return Response.json({ ok: removed });
}
