import { getCurrentUser } from "@/lib/auth";
import { loginMinecraftEmail } from "@/lib/microsoftAuth";
import { rateLimit } from "@/lib/ratelimit";
import { getClientIp } from "@/lib/ip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Turn a Minecraft email + password into the same bearer token the session
// ID method uses. The password is used once for the Microsoft login chain
// and is never stored — only the resulting token is returned to the wizard.
export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me) {
    return Response.json({ error: "Not logged in" }, { status: 401 });
  }

  // Outbound auth calls are expensive and this is password handling — keep
  // it tight: 5 attempts per IP per 10 minutes.
  const rl = rateLimit(`mc-login:${getClientIp(req)}`, 5, 10 * 60 * 1000);
  if (!rl.ok) {
    return Response.json(
      { error: `Too many attempts — try again in ${rl.retryAfterSec}s` },
      { status: 429 },
    );
  }

  let body: { email?: string; password?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const email = (body.email ?? "").trim();
  const password = body.password ?? "";
  if (!email || !password) {
    return Response.json(
      { error: "Email and password required" },
      { status: 400 },
    );
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return Response.json({ error: "That doesn't look like an email" }, { status: 400 });
  }

  try {
    const login = await loginMinecraftEmail(email, password);
    console.warn(`[mc-login] ${me.username} logged in as ${login.name} (${login.id})`);
    return Response.json({
      ok: true,
      token: login.token,
      name: login.name,
      id: login.id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Login failed";
    return Response.json({ error: msg }, { status: 400 });
  }
}
