import { NextResponse } from "next/server";
import {
  getOrCreateDevUser,
  isDiscordConfigured,
  attachSessionCookie,
} from "@/lib/auth";
import { getClientIp, recordUserIp } from "@/lib/ip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Dev/guest login — only available when Discord OAuth is NOT configured.
export async function POST(req: Request) {
  if (isDiscordConfigured()) {
    return NextResponse.json(
      { error: "Dev login is disabled; use Discord." },
      { status: 403 },
    );
  }
  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const name = (body.name ?? "").trim() || "guest";
  const user = await getOrCreateDevUser(name);
  await recordUserIp(user.id, getClientIp(req));
  const res = NextResponse.json({ ok: true });
  attachSessionCookie(res, user.id);
  return res;
}
