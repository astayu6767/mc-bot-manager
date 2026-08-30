import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { shopPlans } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const updates: any = {};
    if (body.tier !== undefined) updates.tier = String(body.tier).toUpperCase();
    if (body.price !== undefined) updates.price = Number(body.price);
    if (body.bots !== undefined) updates.bots = Number(body.bots);
    if (body.hours !== undefined) updates.hours = Number(body.hours);
    if (body.features !== undefined) {
      updates.features = typeof body.features === "string" ? body.features : JSON.stringify(body.features);
    }
    if (body.popular !== undefined) updates.popular = body.popular ? "true" : "false";
    if (body.active !== undefined) updates.active = body.active ? "true" : "false";
    if (body.discount !== undefined) updates.discount = Number(body.discount);

    const [updated] = await db.update(shopPlans).set(updates).where(eq(shopPlans.id, id)).returning();
    if (!updated) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ plan: updated });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    await db.delete(shopPlans).where(eq(shopPlans.id, id));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
