import { getCurrentUser } from "@/lib/auth";
import {
  BOT_TOKEN_KEY,
  getBotStatus,
  getSetting,
  setSetting,
  deleteSetting,
  startDiscordBot,
  stopDiscordBot,
  SITE_URL_KEY,
} from "@/server/discord/bot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Bot invite permissions: View Channel, Send Messages, Embed Links,
// Attach Files, Read History, Manage Channels + Manage Roles (ticket
// channel permission overwrites need Manage Roles).
const INVITE_PERMISSIONS = 268553232;

function tokenHint(token: string): string {
  if (!token) return "";
  return token.length > 8 ? `…${token.slice(-4)}` : "…";
}

export async function GET() {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const token = await getSetting(BOT_TOKEN_KEY);
  const status = getBotStatus();
  return Response.json({
    ...status,
    hasToken: Boolean(token),
    tokenHint: tokenHint(token),
    siteUrl: await getSetting(SITE_URL_KEY),
    inviteUrl: status.applicationId
      ? `https://discord.com/oauth2/authorize?client_id=${status.applicationId}&scope=bot%20applications.commands&permissions=${INVITE_PERMISSIONS}`
      : "",
  });
}

export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { token?: string; siteUrl?: string } = {};
  try {
    body = await req.json();
  } catch {}

  try {
    if (typeof body.siteUrl === "string") {
      const clean = body.siteUrl.trim().replace(/\/+$/, "");
      if (clean && !/^https?:\/\//i.test(clean)) {
        return Response.json({ error: "Site URL must start with http:// or https://" }, { status: 400 });
      }
      if (clean) {
        await setSetting(SITE_URL_KEY, clean);
      } else {
        await deleteSetting(SITE_URL_KEY);
      }
    }

    if (typeof body.token === "string" && body.token.trim()) {
      const token = body.token.trim();
      await setSetting(BOT_TOKEN_KEY, token);
      try {
        await startDiscordBot(token);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start the bot";
        // Invalid token: drop it so the panel doesn't auto-start garbage on reboot
        if (/invalid token/i.test(message)) {
          await deleteSetting(BOT_TOKEN_KEY);
        }
        return Response.json({ ...getBotStatus(), error: message }, { status: 400 });
      }
    }

    const token = await getSetting(BOT_TOKEN_KEY);
    const status = getBotStatus();
    return Response.json({
      ...status,
      hasToken: Boolean(token),
      tokenHint: tokenHint(token),
      siteUrl: await getSetting(SITE_URL_KEY),
      inviteUrl: status.applicationId
        ? `https://discord.com/oauth2/authorize?client_id=${status.applicationId}&scope=bot%20applications.commands&permissions=${INVITE_PERMISSIONS}`
        : "",
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Something went wrong" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const forget = new URL(req.url).searchParams.get("forget") === "1";
  await stopDiscordBot();
  if (forget) {
    await deleteSetting(BOT_TOKEN_KEY);
  }
  const token = await getSetting(BOT_TOKEN_KEY);
  const status = getBotStatus();
  return Response.json({
    ...status,
    hasToken: Boolean(token),
    tokenHint: tokenHint(token),
    inviteUrl: "",
  });
}
