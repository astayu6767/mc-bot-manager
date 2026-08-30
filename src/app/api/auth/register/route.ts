import { NextResponse } from "next/server";
import { registerLocalUser, attachSessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const username = (body.username ?? "").trim();
  const password = body.password ?? "";

  if (!username || !password) {
    return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  }

  if (username.length < 2 || username.length > 32) {
    return NextResponse.json({ error: "Username must be 2-32 chars" }, { status: 400 });
  }

  if (password.length < 3) {
    return NextResponse.json({ error: "Password too short (min 3)" }, { status: 400 });
  }

  try {
    const user = await registerLocalUser(username, password);
    const res = NextResponse.json({ ok: true, user: { id: user.id, username: user.username, role: user.role } });
    attachSessionCookie(res, user.id);
    return res;
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to register" }, { status: 400 });
  }
}
