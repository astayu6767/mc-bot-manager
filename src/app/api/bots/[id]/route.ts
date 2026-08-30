import { db } from "@/db";
import { bots } from "@/db/schema";
import { eq } from "drizzle-orm";
import { stopBot, startBot } from "@/lib/botManager";
import { authorizeBot } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authorizeBot(id);
  if (!auth.ok) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  await stopBot(id);
  await db.delete(bots).where(eq(bots.id, id));
  return Response.json({ ok: true });
}

// Update an existing bot's token and/or version without recreating it.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authorizeBot(id);
  if (!auth.ok) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: {
    token?: string;
    version?: string;
    name?: string;
    host?: string;
    port?: number | string;
    proxy?: string;
    ytChannel?: string;
    beamIp?: string;
    discordUser?: string;
    engine?: string;
    beamType?: string;
    spamMessage?: string;
    spamInterval?: number;
    spamTriggerWord?: string;
    spamReplyMessage?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const [existing] = await db.select().from(bots).where(eq(bots.id, id));
  if (!existing) {
    return Response.json({ error: "Bot not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: Record<string, any> = {};
  if (typeof body.token === "string" && body.token.trim()) {
    updates.token = body.token.trim();
  }
  if (typeof body.version === "string" && body.version.trim()) {
    updates.version = body.version.trim();
  }
  if (typeof body.name === "string" && body.name.trim()) {
    updates.name = body.name.trim();
  }
  // Proxy: allow setting OR clearing (empty string = direct connection).
  if (typeof body.proxy === "string") {
    updates.proxy = body.proxy.trim();
  }
  if (typeof body.ytChannel === "string" && body.ytChannel.trim()) {
    updates.ytChannel = body.ytChannel.trim();
  }
  if (typeof body.beamIp === "string" && body.beamIp.trim()) {
    updates.beamIp = body.beamIp.trim();
  }
  if (typeof body.discordUser === "string" && body.discordUser.trim()) {
    updates.discordUser = body.discordUser.trim();
  }
  if (
    body.engine === "mineflayer" ||
    body.engine === "nmp" ||
    body.engine === "azalea"
  ) {
    updates.engine = body.engine;
  }
  if (body.beamType === "ai" || body.beamType === "spam") {
    updates.beamType = body.beamType;
  }
  if (typeof body.spamMessage === "string") updates.spamMessage = body.spamMessage;
  if (typeof body.spamInterval === "number") updates.spamInterval = body.spamInterval;
  if (typeof body.spamTriggerWord === "string") updates.spamTriggerWord = body.spamTriggerWord;
  if (typeof body.spamReplyMessage === "string") updates.spamReplyMessage = body.spamReplyMessage;

  // Change the target server (host, with optional "host:port", or explicit port).
  if (typeof body.host === "string" && body.host.trim()) {
    const rawHost = body.host.trim();
    let host = rawHost;
    let port = existing.port;
    if (body.port !== undefined && body.port !== "") {
      const p = Number(body.port);
      if (Number.isFinite(p) && p > 0 && p < 65536) port = Math.floor(p);
    }
    const colonIdx = rawHost.lastIndexOf(":");
    if (colonIdx > -1 && !rawHost.includes("]")) {
      const maybePort = Number(rawHost.slice(colonIdx + 1));
      if (Number.isFinite(maybePort) && maybePort > 0 && maybePort < 65536) {
        host = rawHost.slice(0, colonIdx);
        port = Math.floor(maybePort);
      }
    }
    updates.host = host;
    updates.port = port;
  } else if (body.port !== undefined && body.port !== "") {
    // Port-only change.
    const p = Number(body.port);
    if (Number.isFinite(p) && p > 0 && p < 65536) updates.port = Math.floor(p);
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(bots)
    .set(updates)
    .where(eq(bots.id, id))
    .returning();

  // If the bot was running, restart it so the new token/version takes effect.
  const wasRunning =
    existing.status === "online" || existing.status === "connecting";
  if (wasRunning) {
    await stopBot(id);
    void startBot(updated);
  }

  return Response.json({ ok: true, restarted: wasRunning });
}
