import { getCurrentUser } from "@/lib/auth";
import { resolveProfile } from "@/lib/botManager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Resolve a Minecraft session ID (SSID / bearer token) to the account's IGN.
// Used by the add-bot wizard: paste session id -> show the IGN before creating.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const token = (body.token ?? "").trim();
  if (!token) {
    return Response.json({ error: "A session ID is required" }, { status: 400 });
  }

  try {
    const profile = await resolveProfile(token);
    return Response.json({ name: profile.name, id: profile.id });
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Session ID rejected — grab a fresh one",
      },
      { status: 400 },
    );
  }
}
