import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { shopPlans } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createDefaultPlansIfEmpty, getAllPlans, getLtcPriceUSD } from "@/lib/shop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const me = await getCurrentUser();
  // Ensure default plans exist
  await createDefaultPlansIfEmpty();
  const isAdmin = me?.role === "admin";
  const plans = await getAllPlans(!isAdmin ? false : false); // for public only active
  // If admin, return all including inactive
  let result = plans;
  if (isAdmin) {
    const all = await db.select().from(shopPlans).orderBy(shopPlans.price);
    result = all;
  }
  // Parse features JSON
  const parsed = result.map(p => ({
    ...p,
    features: (() => {
      try {
        return JSON.parse(p.features);
      } catch {
        return [];
      }
    })(),
    popular: p.popular === "true",
    active: p.active === "true",
    finalPrice: Math.round(p.price * (1 - p.discount / 100) * 100) / 100,
  }));
  // Live LTC rate for the shop header (best effort; UI hides on failure)
  const ltcPrice = await getLtcPriceUSD().catch(() => null);
  return Response.json({ plans: parsed, ltcPrice });
}

export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const { tier, price, bots, hours, features, popular, active, discount } = body;
    if (!tier || typeof price !== "number") {
      return Response.json({ error: "tier and price required" }, { status: 400 });
    }
    const featuresStr = typeof features === "string" ? features : JSON.stringify(features || []);
    const [plan] = await db.insert(shopPlans).values({
      tier: String(tier).toUpperCase(),
      price: Number(price),
      bots: Number(bots) || 1,
      hours: Number(hours) || 5,
      features: featuresStr,
      popular: popular ? "true" : "false",
      active: active === false ? "false" : "true",
      discount: Number(discount) || 0,
    }).returning();
    return Response.json({ plan });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
