import { getCurrentUser } from "@/lib/auth";
import { redeemLicenseKey } from "@/lib/license";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { key } = body;

  if (!key || typeof key !== "string") {
    return Response.json({ error: "License key required" }, { status: 400 });
  }

  try {
    const license = await redeemLicenseKey(me.id, key);
    return Response.json({ license, message: "License redeemed successfully" });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to redeem" },
      { status: 400 }
    );
  }
}
