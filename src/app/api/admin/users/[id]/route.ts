import { db } from "@/db";
import { users, bots } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { stopBot } from "@/lib/botManager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Update a user's bot slots or role.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  let body: { botSlots?: number | string; role?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Record<string, any> = {};
  if (body.botSlots !== undefined) {
    const n = Number(body.botSlots);
    if (Number.isFinite(n) && n >= 0 && n <= 100) {
      updates.botSlots = Math.floor(n);
    }
  }
  if (body.role === "admin" || body.role === "user") {
    // Prevent removing your own admin role (avoid lockout).
    if (id === me.id && body.role === "user") {
      return Response.json(
        { error: "You can't demote yourself" },
        { status: 400 },
      );
    }
    updates.role = body.role;
  }
  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  await db.update(users).set(updates).where(eq(users.id, id));
  return Response.json({ ok: true });
}

// Delete a user and all their bots.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  if (id === me.id) {
    return Response.json(
      { error: "You can't delete your own account here" },
      { status: 400 },
    );
  }

  const owned = await db.select().from(bots).where(eq(bots.userId, id));
  for (const b of owned) {
    try {
      await stopBot(b.id);
    } catch (err) {
      console.warn(`[users] stopBot failed during delete of ${b.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  await db.delete(bots).where(eq(bots.userId, id));
  await db.delete(users).where(eq(users.id, id));
  return Response.json({ ok: true });
}
