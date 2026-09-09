import { getCurrentUser } from "@/lib/auth";
import { resolveProfile } from "@/lib/botManager";
import { rateLimit } from "@/lib/ratelimit";

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

  // This endpoint validates credentials — throttle probing hard.
  const rl = rateLimit(`resolve:${user.id}`, 15, 60_000);
  if (!rl.ok) {
    return Response.json(
      { error: `Too many checks — retry in ${rl.retryAfterSec}s` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  try {
    const profile = await resolveProfile(token);
    return Response.json(
      { name: profile.name, id: profile.id },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    // Full detail stays in the server log; users get one clear sentence.
    console.warn(
      `[resolve-session] rejected: ${err instanceof Error ? err.message : String(err)}`,
    );
    return Response.json(
      { error: "Invalid SSID, Kindly provide a new one" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
