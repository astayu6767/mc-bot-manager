import { db } from "@/db";
import { bots } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { restartBeamIfRunning } from "@/lib/botManager";
import { isAiModeEnabled, setAiModeEnabled } from "@/lib/maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Current AI-mode state for the admin panel.
export async function GET() {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return Response.json({ enabled: await isAiModeEnabled() });
}

// Toggle AI mode (1v1 Player Method). Turning it OFF switches every AI bot
// to lobby adbot mode (running beams restart in lobby immediately) and
// blocks creating new AI bots until it's turned back ON.
export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { enabled?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return Response.json(
      { error: "Body needs { enabled: true | false }" },
      { status: 400 },
    );
  }

  await setAiModeEnabled(body.enabled);

  let switched = 0;
  if (!body.enabled) {
    const rows = await db
      .update(bots)
      .set({ beamType: "lobby" })
      .where(eq(bots.beamType, "ai"))
      .returning();
    switched = rows.length;
    console.warn(
      `[admin] ${me.username} disabled AI mode — ${switched} bot(s) switched to lobby`,
    );
    // Restarting waits for each old beam loop to fully exit (can take a
    // while mid-chat) — run in the background so this request returns fast.
    if (rows.length > 0) {
      void (async () => {
        let restarted = 0;
        for (const b of rows) {
          try {
            if (await restartBeamIfRunning(b.id)) restarted++;
          } catch (err) {
            console.warn(
              `[ai-mode] beam restart failed for ${b.id}: ${err instanceof Error ? err.message : err}`,
            );
          }
        }
        console.log(`[ai-mode] ${restarted}/${rows.length} beam(s) restarted in lobby mode`);
      })();
    }
  } else {
    console.warn(`[admin] ${me.username} enabled AI mode`);
  }

  return Response.json({ ok: true, enabled: body.enabled, switched });
}
