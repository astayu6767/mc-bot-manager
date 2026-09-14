import { isAiModeEnabled } from "@/lib/maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Public feature flag — the Add Bot wizard uses it to grey out the 1v1 AI
// mode while an admin has it disabled. Just a boolean, nothing sensitive.
export async function GET() {
  return Response.json({ enabled: await isAiModeEnabled() });
}
