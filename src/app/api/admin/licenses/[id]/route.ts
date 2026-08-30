import { getCurrentUser } from "@/lib/auth";
import { revokeLicense, deleteLicense, revokeLicenseKey, deleteLicenseKey } from "@/lib/license";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "key"; // default to key

  try {
    if (type === "license") {
      await deleteLicense(id);
    } else {
      await deleteLicenseKey(id);
    }
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to delete" },
      { status: 400 }
    );
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const type = body.type || "key";

  try {
    if (body.action === "revoke") {
      if (type === "license") {
        await revokeLicense(id);
      } else {
        await revokeLicenseKey(id);
      }
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 400 }
    );
  }
}
