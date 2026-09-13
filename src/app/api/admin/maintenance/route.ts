import { db } from "@/db";
import { bots } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getRuntimeView, stopBot } from "@/lib/botManager";
import { isMaintenanceOn, setMaintenance } from "@/lib/maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Current maintenance state for the admin panel.
export async function GET() {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return Response.json({ on: await isMaintenanceOn() });
}

// Toggle maintenance. Turning it ON stops every running bot immediately —
// startBot refuses new starts while the flag is set (users get a friendly
// "site is currently in maintenance" popup from the start endpoint).
export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { on?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  if (typeof body.on !== "boolean") {
    return Response.json(
      { error: "Body needs { on: true | false }" },
      { status: 400 },
    );
  }

  await setMaintenance(body.on);

  let stopped = 0;
  if (body.on) {
    const all = await db.select().from(bots);
    for (const b of all) {
      // Only count bots that were actually running.
      if (getRuntimeView(b.id).status === "offline") continue;
      try {
        await stopBot(b.id);
        stopped++;
      } catch (err) {
        console.warn(
          `[maintenance] stopBot failed for ${b.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    console.warn(
      `[admin] ${me.username} enabled maintenance — ${stopped} bot(s) stopped`,
    );
  } else {
    console.warn(`[admin] ${me.username} disabled maintenance`);
  }

  return Response.json({ ok: true, on: body.on, stopped });
}
