import { NextResponse } from "next/server";
import { getCurrentUser, createLocalUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { username?: string; password?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  const role = body.role === "admin" ? "admin" : "user";

  if (!username || !password) {
    return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  }

  try {
    const user = await createLocalUser({ username, password, role });
    return NextResponse.json({ ok: true, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create" }, { status: 400 });
  }
}
