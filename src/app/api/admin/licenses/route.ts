import { getCurrentUser } from "@/lib/auth";
import { getAllLicenses, getAllLicenseKeys, createLicenseKey } from "@/lib/license";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const [licenseKeys, licenses] = await Promise.all([
    getAllLicenseKeys(),
    getAllLicenses(),
  ]);
  return Response.json({ licenseKeys, licenses });
}

export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { slots, durationDays, durationHours, reason } = body;

  // New flow: admin generates a redeemable key like abeam-key-xxx
  // No userId needed - key is redeemed by user in License tab
  try {
    const licenseKey = await createLicenseKey({
      slots: Number(slots) || 1,
      durationDays: Number(durationDays) || 0,
      durationHours: Number(durationHours) || 0,
      reason: reason || "",
      createdBy: me.id,
    });

    return Response.json({ licenseKey, key: licenseKey.key });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to create license key" },
      { status: 400 }
    );
  }
}
