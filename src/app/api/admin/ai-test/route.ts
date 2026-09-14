import { getCurrentUser } from "@/lib/auth";
import { aiTestInfo, aiTestProvider, type TestableProvider } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID: TestableProvider[] = ["tokenharbour", "pollinations", "openrouter"];

// Provider list (label + effective model) for the admin test panel.
export async function GET() {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return Response.json({ providers: aiTestInfo() });
}

// Send a plain hello to exactly ONE provider — no fallback chain — so the
// result proves whether that provider is live and shows the raw error if not.
export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { provider?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const provider = body.provider as TestableProvider;
  if (!VALID.includes(provider)) {
    return Response.json(
      { error: "Provider must be tokenharbour, pollinations or openrouter" },
      { status: 400 },
    );
  }

  const result = await aiTestProvider(provider);
  console.warn(
    `[ai-test] ${me.username} tested ${provider}: ${result.text ? "LIVE" : "FAILED"} in ${result.ms}ms${result.error ? ` — ${result.error}` : ""}`,
  );

  return Response.json({
    ok: Boolean(result.text),
    provider,
    reply: result.text,
    error: result.error,
    ms: result.ms,
  });
}
