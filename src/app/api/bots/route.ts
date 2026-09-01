import { db } from "@/db";
import { bots } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { getRuntimeView, startBot, resumeEnabledBots } from "@/lib/botManager";
import { getCurrentUser } from "@/lib/auth";
import { getUserLicenseStatus, canUserCreateBot } from "@/lib/license";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  void resumeEnabledBots();

  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const rows = await db
    .select()
    .from(bots)
    .where(eq(bots.userId, user.id))
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
      proxy: b.proxy,
      ytChannel: b.ytChannel,
      beamIp: b.beamIp,
      discordUser: b.discordUser,
      engine: b.engine,
      beamType: b.beamType,
      spamMessage: b.spamMessage,
      spamInterval: b.spamInterval,
      spamTriggerWord: b.spamTriggerWord,
      spamReplyMessage: b.spamReplyMessage,
      status: rt.status,
      joined: rt.joined,
      lastError: rt.lastError ?? b.lastError,
      createdAt: b.createdAt,
    };
  });

  // Use license system - 0 slots by default
  const licenseStatus = await getUserLicenseStatus(user.id);
  return Response.json({
    bots: data,
    slots: licenseStatus.totalSlots,
    used: data.length,
    licenseStatus,
  });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Enforce license-based slot limit (0 by default)
  const check = await canUserCreateBot(user.id);
  if (!check.allowed) {
    return Response.json(
      {
        error: check.reason || "No slots available. Get a license.",
      },
      { status: 403 },
    );
  }

  let body: {
    name?: string;
    token?: string;
    host?: string;
    port?: number | string;
    version?: string;
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

  const token = (body.token ?? "").trim();
  const rawHost = (body.host ?? "").trim();
  if (!token) {
    return Response.json({ error: "A Minecraft token is required" }, { status: 400 });
  }
  if (!rawHost) {
    return Response.json({ error: "A server address is required" }, { status: 400 });
  }

  // Allow "host:port" in the address field.
  let host = rawHost;
  let port = 25565;
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

  const name = (body.name ?? "").trim() || host;
  const version = (body.version ?? "").trim() || "auto";
  const proxy = (body.proxy ?? "").trim();
  const ytChannel = (body.ytChannel ?? "").trim() || "Alight.z";
  const beamIp = (body.beamIp ?? "").trim() || "badlion-pvp.xyz";
  const discordUser = (body.discordUser ?? "").trim() || "stood014";
  const engine =
    body.engine === "nmp" || body.engine === "azalea" || body.engine === "mineflayer"
      ? body.engine
      : "azalea";
  const beamType = (body.beamType === "spam" || body.beamType === "lobby") ? body.beamType : "ai";
  const spamMessage = (body.spamMessage ?? "").trim() || "type 123 in chat for tier test all mode";
  const spamInterval = Number.isFinite(Number(body.spamInterval)) ? Number(body.spamInterval) : 60000;
  const spamTriggerWord = (body.spamTriggerWord ?? "").trim() || "123";
  const spamReplyMessage = (body.spamReplyMessage ?? "").trim() || "add my discord stood014 to join";

  const [inserted] = await db
    .insert(bots)
    .values({
      userId: user.id,
      name,
      token,
      host,
      port,
      version,
      proxy,
      ytChannel,
      beamIp,
      discordUser,
      engine,
      beamType,
      spamMessage,
      spamInterval,
      spamTriggerWord,
      spamReplyMessage,
      status: "connecting",
      enabled: "true",
    })
    .returning();

  // Kick off the connection (don't block the HTTP response on the full join).
  void startBot(inserted);

  return Response.json({ id: inserted.id }, { status: 201 });
}
