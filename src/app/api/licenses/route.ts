import { getCurrentUser } from "@/lib/auth";
import { getUserLicenseStatus } from "@/lib/license";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const me = await getCurrentUser();
  if (!me) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await getUserLicenseStatus(me.id);
  return Response.json(status);
}
