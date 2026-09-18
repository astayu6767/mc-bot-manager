import fs from "fs";
import { db } from "@/db";
import { bots, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { listBotInstances, stopBot } from "@/lib/botManager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SidecarProc = { pid: number; cmdline: string };

/// All engine sidecar processes running on this server, straight from /proc.
function listSidecarProcesses(): SidecarProc[] {
  const out: SidecarProc[] = [];
  try {
    for (const ent of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(ent)) continue;
      const pid = Number(ent);
      try {
        const cmdline = fs
          .readFileSync(`/proc/${pid}/cmdline`, "utf8")
          .split("\0")
          .filter(Boolean)
          .join(" ")
          .trim();
        if (cmdline.includes("azalea-bridge")) out.push({ pid, cmdline });
      } catch {
        // process exited between readdir and read — ignore
      }
    }
  } catch {
    // /proc not readable (non-Linux) — no process-level view available
  }
  return out;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/// Kill an orphaned sidecar process. Only ever touches processes whose
/// command line is an engine sidecar — never arbitrary PIDs.
async function killOrphan(pid: number): Promise<{ ok: boolean; message: string }> {
  let cmdline = "";
  try {
    cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
  } catch {
    return { ok: true, message: "That process already stopped." };
  }
  if (!cmdline.includes("azalea-bridge")) {
    return { ok: false, message: "That is not an engine process — leaving it alone." };
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return { ok: true, message: "That process already stopped." };
  }
  await new Promise((r) => setTimeout(r, 1200));
  if (pidAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // raced away — fine
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return pidAlive(pid)
    ? { ok: false, message: "The process refused to stop — try again in a moment." }
    : { ok: true, message: `Stopped orphaned engine process ${pid}.` };
}

export async function GET() {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const [allBots, allUsers] = await Promise.all([
    db.select().from(bots),
    db.select().from(users),
  ]);
  const botById = new Map(allBots.map((b) => [b.id, b]));
  const userById = new Map(allUsers.map((u) => [u.id, u]));

  const procs = listSidecarProcesses();
  const procPids = new Set(procs.map((p) => p.pid));

  const instances = listBotInstances().map((inst) => {
    const b = botById.get(inst.botId);
    const owner = b?.userId ? userById.get(b.userId) : undefined;
    return {
      botId: inst.botId,
      name: b?.name ?? "(deleted bot)",
      owner: owner?.username ?? "unknown",
      engine: b?.engine ?? inst.engine ?? "nmp",
      status: inst.status,
      pid: inst.pid,
      processAlive: inst.pid !== null && procPids.has(inst.pid),
      startedAt: inst.startedAt,
      heartbeatAgeS: inst.heartbeatAgeS,
      tickAgeS: inst.tickAgeS,
      online: inst.online,
      beamStage: inst.beamStage,
    };
  });

  // Orphans: engine processes on the server that no registered runtime owns
  // (left behind by a crash, a deploy, or a respawn race).
  const registryPids = new Set(
    instances
      .map((r) => r.pid)
      .filter((p): p is number => typeof p === "number"),
  );
  const orphans = procs
    .filter((p) => !registryPids.has(p.pid) && p.pid !== process.pid)
    .map((p) => ({ pid: p.pid, cmdline: p.cmdline }));

  return Response.json({ instances, orphans });
}

export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: { botId?: unknown; pid?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  if (typeof body.botId === "string" && body.botId) {
    try {
      await stopBot(body.botId);
      return Response.json({ ok: true, message: "Instance stopped." });
    } catch {
      return Response.json(
        { error: "Could not stop that instance — try force stopping its process below." },
        { status: 500 },
      );
    }
  }

  if (typeof body.pid === "number" && Number.isInteger(body.pid)) {
    if (body.pid <= 1 || body.pid === process.pid) {
      return Response.json({ error: "That process can not be stopped." }, { status: 400 });
    }
    const result = await killOrphan(body.pid);
    if (!result.ok) return Response.json({ error: result.message }, { status: 500 });
    return Response.json({ ok: true, message: result.message });
  }

  return Response.json({ error: "Pick a bot or a process to stop." }, { status: 400 });
}
