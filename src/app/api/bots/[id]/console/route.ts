import {
  getLogs,
  getRuntimeView,
  sendChat,
  getBeamState,
  getAiProviderStats,
} from "@/lib/botManager";
import { authorizeBot } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authorizeBot(id);
  if (!auth.ok) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const view = getRuntimeView(id);
  return Response.json({
    logs: getLogs(id),
    status: view.status,
    joined: view.joined,
    lastError: view.lastError,
    beam: getBeamState(id),
    ai: getAiProviderStats(),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authorizeBot(id);
  if (!auth.ok) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: { message?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const message = (body.message ?? "").trim();
  if (!message) {
    return Response.json({ error: "Message is required" }, { status: 400 });
  }
  const ok = sendChat(id, message);
  if (!ok) {
    return Response.json(
      { error: "Bot is not online — can't send chat" },
      { status: 409 },
    );
  }
  return Response.json({ ok: true });
}
