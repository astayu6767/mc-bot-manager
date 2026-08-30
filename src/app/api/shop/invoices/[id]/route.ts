import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { invoices, shopPlans } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!invoice) return Response.json({ error: "Not found" }, { status: 404 });

  if (me.role !== "admin" && invoice.userId !== me.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Check expiry
  if (invoice.status === "pending" && new Date(invoice.expiresAt) < new Date()) {
    await db.update(invoices).set({ status: "expired" }).where(eq(invoices.id, id));
    invoice.status = "expired";
  }

  let plan = null;
  if (invoice.planId) {
    const [p] = await db.select().from(shopPlans).where(eq(shopPlans.id, invoice.planId));
    plan = p || null;
  }

  return Response.json({ 
    invoice: {
      ...invoice,
      // Don't expose private key to non-admin? But for forwarding demo we need it admin only
      ltcPrivateKey: me.role === "admin" ? invoice.ltcPrivateKey : undefined,
      plan,
    }
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!invoice) return Response.json({ error: "Not found" }, { status: 404 });

  if (me.role !== "admin" && invoice.userId !== me.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (invoice.status === "pending") {
    await db.update(invoices).set({ status: "expired" }).where(eq(invoices.id, id));
    return Response.json({ ok: true, status: "expired" });
  }

  return Response.json({ error: "Cannot cancel paid invoice" }, { status: 400 });
}
