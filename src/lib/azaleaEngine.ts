import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import readline from "readline";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bots, type Bot } from "@/db/schema";
import type { BotStatus, LogEntry, ViewSnapshot } from "@/app/types";

export type AzaleaRuntime = {
  id: string;
  status: BotStatus;
  joined: boolean;
  lastError: string | null;
  logs: LogEntry[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bot: any | null;
  manualStop: boolean;
  nmpPlayers: Set<string>;
  azaleaChild?: ChildProcess | null;
  azaleaSnap?: ViewSnapshot | null;
};

type Helpers = {
  // Runtime is the botManager BotRuntime; keep this loose to avoid a cycle.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  log: (rt: any, level: LogEntry["level"], line: string) => void;
  setDbStatus: (
    id: string,
    status: BotStatus,
    lastError?: string | null,
  ) => Promise<void>;
  resolveProfile: (token: string) => Promise<{ id: string; name: string }>;
};

function findAzaleaBinary(): string | null {
  const candidates = [
    process.env.AZALEA_BRIDGE_BIN,
    "/usr/local/bin/azalea-bridge",
    path.join(process.cwd(), "azalea-bridge", "target", "release", "azalea-bridge"),
    path.join(process.cwd(), "bin", "azalea-bridge"),
  ].filter((s): s is string => Boolean(s));
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch {
      // ignore
    }
  }
  return null;
}

// Filter noisy azalea logs from showing in chatbox/console.
// NOTE: connection-fatal errors ("error reading packet", "failed to fill whole
// buffer") are deliberately NOT muted anymore — they're the only visible signal
// when the azalea client silently dies mid-session (e.g. after a proxy server
// switch). First occurrence of each distinct line is shown, repeats suppressed.
const seenAzaleaNoisy = new Set<string>();

function shouldFilterAzaleaLog(line: string): boolean {
  const lower = line.toLowerCase();
  if (
    lower.includes("error reading packet") ||
    lower.includes("failed to fill whole buffer")
  ) {
    if (seenAzaleaNoisy.has(line)) return true;
    if (seenAzaleaNoisy.size > 400) seenAzaleaNoisy.clear();
    seenAzaleaNoisy.add(line);
    return false; // let the first one through
  }
  const filters = [
    "more than 1,000 items",
    "packet-event",
    "explode (id 36)",
    "packet explode",
    "azalea_client::plugins::connection",
    "explode",
  ];
  return filters.some((f) => lower.includes(f));
}

class AzaleaHandle extends EventEmitter {
  child: ChildProcess;
  username: string;
  using = false;
  entity: { position: { x: number; y: number; z: number }; yaw: number; pitch: number } | null =
    null;
  health = 20;
  food = 20;
  inventory = { slots: [] as unknown[] };
  quickBarSlot = 0;
  heldItem: { name: string; displayName: string; count: number } | null = null;
  currentWindow: unknown = null;
  physicsEnabled = false;
  version = "26.1";
  players: Record<string, { username: string }> = {};

  constructor(child: ChildProcess, username: string) {
    super();
    this.child = child;
    this.username = username;
  }

  private send(payload: Record<string, unknown>) {
    try {
      this.child.stdin?.write(JSON.stringify(payload) + "\n");
    } catch {
      // ignore
    }
  }

  chat(message: string) {
    this.send({ op: "chat", text: message });
  }

  quit() {
    this.send({ op: "disconnect" });
    try {
      this.child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }

  end(_reason?: string) {
    this.quit();
  }

  setControlState(dir: string, on: boolean) {
    const map: Record<string, string> = {
      forward: "forward",
      back: "back",
      left: "left",
      right: "right",
      sneak: "sneak",
      jump: "jump",
    };
    const mapped = map[dir] ?? dir;
    if (mapped === "jump" && on) {
      this.send({ op: "jump" });
      return;
    }
    if (mapped === "sneak") {
      this.send({ op: "sneak", on });
      return;
    }
    this.send({ op: "walk", dir: mapped, on, ms: on ? 600 : 0 });
  }

  clearControlStates() {
    this.send({ op: "walk", dir: "none", on: false });
    this.send({ op: "sneak", on: false });
  }

  async setQuickBarSlot(slot: number) {
    this.quickBarSlot = slot;
    this.send({ op: "select", slot });
  }

  activateItem() {
    this.using = true;
    this.send({ op: "use" });
  }

  deactivateItem() {
    this.using = false;
    this.send({ op: "use_stop" });
  }

  async consume() {
    this.activateItem();
    await new Promise((r) => setTimeout(r, 1600));
    this.deactivateItem();
  }

  async tossStack(_held: unknown) {
    this.send({ op: "drop" });
  }

  clickWindow(slot: number) {
    this.send({ op: "clickWindow", slot });
  }

  closeWindow(_window?: unknown) {
    this.send({ op: "closeWindow" });
  }

  look(_yaw: number, _pitch: number, _force?: boolean) {
    this.send({ op: "look" });
  }

  nearestEntity() {
    return null;
  }
}

export async function startAzaleaBot(
  record: Bot,
  rt: AzaleaRuntime,
  helpers: Helpers,
): Promise<void> {
  const { log, setDbStatus, resolveProfile } = helpers;

  const bin = findAzaleaBinary();
  if (!bin) {
    const msg =
      "Azalea engine selected, but the azalea-bridge binary is missing. Rebuild the Docker image (first build compiles the Rust client and takes several minutes).";
    rt.status = "error";
    rt.lastError = msg;
    log(rt, "error", msg);
    await setDbStatus(record.id, "error", msg);
    return;
  }

  let profile: { id: string; name: string };
  try {
    log(rt, "system", "Validating Minecraft token...");
    profile = await resolveProfile(record.token);
    log(rt, "system", `Authenticated as ${profile.name} (${profile.id}).`);
    try {
      await db
        .update(bots)
        .set({ username: profile.name, uuid: profile.id })
        .where(eq(bots.id, record.id));
    } catch {
      // ignore — status still proceeds
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    rt.status = "error";
    rt.lastError = msg;
    log(rt, "error", msg);
    await setDbStatus(record.id, "error", msg);
    return;
  }

  log(
    rt,
    "system",
    `Starting Azalea sidecar (${bin}). Protocol is latest vanilla (Minecraft 26.1) — ViaVersion servers accept it; 1.8-only servers will not.`,
  );

  const child = spawn(bin, [], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, RUST_LOG: process.env.RUST_LOG || "warn" },
  });
  rt.azaleaChild = child;

  const handle = new AzaleaHandle(child, profile.name);
  rt.bot = handle;

  const writeStart = () => {
    const start = {
      op: "start",
      host: record.host,
      port: record.port,
      username: profile.name,
      uuid: profile.id,
      token: record.token,
      proxy: record.proxy || "",
    };
    child.stdin?.write(JSON.stringify(start) + "\n");
  };

  if (child.stdin) {
    writeStart();
  } else {
    child.once("spawn", writeStart);
  }

  const onLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (shouldFilterAzaleaLog(trimmed)) {
      console.debug(`[filtered azalea] ${trimmed}`);
      return;
    }
    let msg: {
      ev?: string;
      level?: LogEntry["level"];
      line?: string;
      status?: BotStatus;
      name?: string;
      available?: boolean;
    } & Partial<ViewSnapshot>;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      log(rt, "system", trimmed);
      return;
    }
    switch (msg.ev) {
      case "log": {
        const logLine = String(msg.line || "");
        if (shouldFilterAzaleaLog(logLine)) return;
        log(rt, msg.level || "system", logLine);
        break;
      }
      case "chat": {
        const text = String(msg.line || "");
        log(rt, "chat", text);
        handle.emit("messagestr", text);
        break;
      }
      case "status":
        if (msg.status === "online") {
          const wasOffline = rt.status !== "online";
          rt.status = "online";
          rt.joined = true;
          rt.lastError = null;
          // On (re)connect, drop players tracked from the previous session so
          // beam targeting starts fresh (also fires again after an auto-rejoin).
          if (wasOffline) rt.nmpPlayers.clear();
          void setDbStatus(record.id, "online");
        }
        break;
      case "error": {
        const errLine = String(msg.line || "Azalea error");
        if (shouldFilterAzaleaLog(errLine)) return;
        log(rt, "error", errLine);
        if (!rt.manualStop) {
          rt.status = "error";
          rt.lastError = errLine;
          rt.joined = false;
          void setDbStatus(record.id, "error", errLine);
        }
        handle.emit("kicked", errLine);
        break;
      }
      case "death":
        handle.emit("death");
        log(rt, "system", "Bot died.");
        break;
      case "player_add":
        if (msg.name) {
          rt.nmpPlayers.add(msg.name);
          handle.players[msg.name] = { username: msg.name };
          handle.emit("playerJoined", { username: msg.name });
        }
        break;
      case "player_remove":
        if (msg.name) {
          rt.nmpPlayers.delete(msg.name);
          delete handle.players[msg.name];
          handle.emit("playerLeft", { username: msg.name });
        }
        break;
      case "snapshot": {
        const snap: ViewSnapshot = {
          available: true,
          username: (msg.username as string) || profile.name,
          position: msg.position || { x: 0, y: 0, z: 0 },
          yaw: Number(msg.yaw || 0),
          pitch: Number(msg.pitch || 0),
          facing: (msg.facing as string) || "S",
          health: Number(msg.health ?? 20),
          food: Number(msg.food ?? 20),
          dimension: (msg.dimension as string) || "overworld",
          timeOfDay: Number(msg.timeOfDay ?? 0),
          isDay: msg.isDay !== false,
          heldItem: (msg.heldItem as string | null) ?? null,
          lookingAt: msg.lookingAt ?? null,
          entities: msg.entities ?? [],
          nearbyBlocks: msg.nearbyBlocks ?? [],
          hotbar: msg.hotbar ?? [],
          selectedSlot: Number(msg.selectedSlot ?? 0),
          using: handle.using,
          window: msg.window ?? null,
        };
        rt.azaleaSnap = snap;
        handle.entity = {
          position: snap.position || { x: 0, y: 0, z: 0 },
          yaw: snap.yaw || 0,
          pitch: snap.pitch || 0,
        };
        handle.health = snap.health || 20;
        handle.food = snap.food || 20;
        handle.quickBarSlot = snap.selectedSlot || 0;
        // Keep heldItem in sync so botManager's use/drop checks work
        if (snap.heldItem) {
          handle.heldItem = {
            name: snap.heldItem,
            displayName: snap.heldItem,
            count: 1,
          };
        } else {
          const sel = snap.hotbar?.find((h: any) => h.selected);
          if (sel?.name) {
            handle.heldItem = {
              name: sel.name,
              displayName: sel.displayName || sel.name,
              count: sel.count || 1,
            };
          } else {
            handle.heldItem = null;
          }
        }
        // Keep currentWindow reference for close logic
        handle.currentWindow = snap.window || null;
        break;
      }
      case "end":
        if (rt.manualStop) {
          rt.status = "offline";
          log(rt, "system", "Bot stopped.");
          void setDbStatus(record.id, "offline");
        } else if (rt.status !== "error") {
          const reason = String(msg.line || "azalea exited");
          if (shouldFilterAzaleaLog(reason)) {
            rt.status = "offline";
            rt.lastError = null;
            log(rt, "system", "Bot stopped (filtered noisy disconnect).");
            void setDbStatus(record.id, "offline");
          } else {
            rt.status = rt.joined ? "offline" : "error";
            rt.lastError = rt.joined ? null : `Disconnected: ${reason}`;
            log(rt, rt.joined ? "system" : "error", `Disconnected: ${reason}`);
            void setDbStatus(record.id, rt.status, rt.lastError);
          }
        }
        rt.joined = false;
        handle.emit("end", String(msg.line || "end"));
        break;
      default:
        break;
    }
  };

  if (child.stdout) {
    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", onLine);
  }

  if (child.stderr) {
    const rlErr = readline.createInterface({ input: child.stderr });
    rlErr.on("line", (line) => {
      const t = line.trim();
      if (!t) return;
      if (shouldFilterAzaleaLog(t)) {
        console.debug(`[filtered azalea log] ${t}`);
        return;
      }
      log(rt, "system", `[azalea] ${t}`);
    });
  }

  child.on("error", (err) => {
    const msg = "Failed to spawn Azalea bridge: " + err.message;
    rt.status = "error";
    rt.lastError = msg;
    log(rt, "error", msg);
    void setDbStatus(record.id, "error", msg);
  });

  child.on("exit", (code, signal) => {
    rt.azaleaChild = null;
    if (rt.manualStop) {
      rt.status = "offline";
      rt.joined = false;
      void setDbStatus(record.id, "offline");
      return;
    }
    if (rt.status === "online" || rt.status === "connecting") {
      const msg = `Azalea process exited (code=${code ?? "?"} signal=${signal ?? "none"}).`;
      rt.status = "error";
      rt.joined = false;
      rt.lastError = msg;
      log(rt, "error", msg);
      void setDbStatus(record.id, "error", msg);
    }
  });
}
