import { getCurrentUser } from "@/lib/auth";
import { getOwnerLtcAddress, setOwnerLtcAddress } from "@/lib/shop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const ownerAddress = await getOwnerLtcAddress();
  return Response.json({ ownerLtcAddress: ownerAddress });
}

export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const { ownerLtcAddress } = body;
    if (!ownerLtcAddress || typeof ownerLtcAddress !== "string" || ownerLtcAddress.length < 10) {
      return Response.json({ error: "Invalid LTC address" }, { status: 400 });
    }
    await setOwnerLtcAddress(ownerLtcAddress.trim());
    return Response.json({ ok: true, ownerLtcAddress: ownerLtcAddress.trim() });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
