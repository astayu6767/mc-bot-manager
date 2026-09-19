import { getCurrentUser } from "@/lib/auth";
import { getBeamStats } from "@/lib/beamContacts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const stats = await getBeamStats();
    return Response.json(stats);
  } catch {
    return Response.json({ error: "Could not load beam stats." }, { status: 500 });
  }
}
