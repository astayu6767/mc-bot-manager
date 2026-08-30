"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BotItem, BotStatus, LogEntry, HotbarItem, ViewSnapshot } from "./types";
import { StatusBadge, BotAvatar } from "./BotDashboard";

// Extract shared types into a new file or reuse them. For now, since they are needed here:
export default function BotDetailView({
  bot,
  onChanged,
}: {
  bot: BotItem;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<"console" | "screen">("console");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<BotStatus>(bot.status);
  const [msg, setMsg] = useState("");
  const [beam, setBeam] = useState<{ looping: boolean; stage: string }>({
    looping: false,
    stage: "",
  });
  const [acting, setActing] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [snap, setSnap] = useState<ViewSnapshot | null>(null);

  const poll = useCallback(async () => {
    try {
      const endpoint = tab === "console" ? "console" : "view";
      const res = await fetch(`/api/bots/${bot.id}/${endpoint}`, {
        cache: "no-store",
      });
      const data = await res.json();
      setStatus(data.status ?? "offline");
      setBeam(data.beam ?? { looping: false, stage: "" });
      if (tab === "console") {
        setLogs(data.logs ?? []);
      } else {
        setSnap(data.snapshot ?? { available: false });
      }
    } catch {
      /* ignore */
    }
  }, [bot.id, tab]);

  useEffect(() => {
    poll();
    const t = setInterval(poll, tab === "console" ? 1500 : 700);
    return () => clearInterval(t);
  }, [poll, tab]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [logs]);

  async function act(action: string, method = "POST") {
    setActing(true);
    try {
      await fetch(`/api/bots/${bot.id}/${action}`, { method });
      await onChanged();
      await poll();
    } finally {
      setActing(false);
    }
  }

  async function doAction(action: string, payload: any = {}) {
    setActing(true);
    try {
      await fetch(`/api/bots/${bot.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      await poll();
    } finally {
      setActing(false);
    }
  }

  async function sendChat() {
    const m = msg.trim();
    if (!m) return;
    setMsg("");
    await fetch(`/api/bots/${bot.id}/console`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: m }),
    });
    poll();
  }

  async function toggleBeam() {
    await doAction(beam.looping ? "beam_stop" : "beam_start");
  }

  const running = status === "online" || status === "connecting";

  return (
    <div className="glass flex flex-col overflow-hidden rounded-[24px]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 bg-white/[0.02] px-6 py-4">
        <div className="flex items-center gap-4">
          <BotAvatar
            username={bot.username}
            status={status}
            className="h-12 w-12 rounded-2xl text-2xl shadow-lg transition-colors"
          />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-white">{bot.name}</h2>
              <StatusBadge status={status} />
              {beam.looping && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-xs font-medium text-fuchsia-300 ring-1 ring-fuchsia-500/30">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-fuchsia-400" />
                  beam: {beam.stage || "running"}
                </span>
              )}
            </div>
            <p className="text-sm font-medium text-slate-400">
              {bot.host}:{bot.port}
              {bot.username && ` · as ${bot.username}`}
              {bot.engine && ` · ${bot.engine === "azalea" ? "Azalea" : bot.engine === "nmp" ? "NMP" : "Mineflayer"}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {beam.looping ? (
            <button
              onClick={toggleBeam}
              disabled={acting}
              className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-semibold text-rose-950 transition hover:bg-rose-400 disabled:opacity-40"
            >
              ⏹ Stop Beam
            </button>
          ) : (
            <button
              onClick={toggleBeam}
              disabled={acting || status !== "online"}
              className="rounded-xl bg-fuchsia-500 px-4 py-2 text-sm font-semibold text-fuchsia-950 transition hover:bg-fuchsia-400 disabled:opacity-40"
            >
              📡 Beam
            </button>
          )}
          {running ? (
            <button
              disabled={acting}
              onClick={() => act("stop")}
              className="rounded-xl bg-amber-500/90 px-4 py-2 text-sm font-semibold text-amber-950 transition hover:bg-amber-400 disabled:opacity-40"
            >
              Stop Bot
            </button>
          ) : (
            <button
              disabled={acting}
              onClick={() => act("start")}
              className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-40"
            >
              Start Bot
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/5 bg-black/20 px-6">
        <button
          onClick={() => setTab("console")}
          className={`border-b-2 px-4 py-3 text-sm font-medium transition ${
            tab === "console"
              ? "border-emerald-400 text-emerald-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          Console
        </button>
        <button
          onClick={() => setTab("screen")}
          className={`border-b-2 px-4 py-3 text-sm font-medium transition ${
            tab === "screen"
              ? "border-emerald-400 text-emerald-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          Screen / Game View
        </button>
      </div>

      {/* Content */}
      <div className="flex h-[65vh] flex-col bg-[#030712]/50">
        {tab === "console" ? (
          <>
            <div
              ref={scroller}
              onScroll={(e) => {
                const el = e.currentTarget;
                stickToBottom.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 40;
              }}
              className="flex-1 overflow-y-auto p-4 font-mono text-sm leading-relaxed"
            >
              {logs.length === 0 ? (
                <p className="text-slate-600">No output yet…</p>
              ) : (
                logs.map((l, i) => {
                  const w = whisperKind(l.line);
                  return (
                    <div key={i} className="whitespace-pre-wrap break-words">
                      <span className="text-slate-600">
                        {new Date(l.ts).toLocaleTimeString()}{" "}
                      </span>
                      {w === "from" ? (
                        <span className="rounded bg-cyan-500/15 px-1 font-semibold text-cyan-300 ring-1 ring-cyan-500/30">
                          {l.line}
                        </span>
                      ) : w === "to" ? (
                        <span className="rounded bg-fuchsia-500/15 px-1 font-semibold text-fuchsia-300 ring-1 ring-fuchsia-500/30">
                          {l.line}
                        </span>
                      ) : (
                        <span className={logColor(l.level)}>{l.line}</span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            <div className="flex gap-3 border-t border-white/5 bg-black/20 p-4">
              <input
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChat()}
                placeholder={
                  status === "online"
                    ? "Type a chat message or command…"
                    : "Bot must be online to chat"
                }
                disabled={status !== "online"}
                className="w-full rounded-xl border border-slate-700/80 bg-slate-950/60 px-4 py-2.5 font-mono text-sm text-slate-100 placeholder:text-slate-600 outline-none transition focus:border-emerald-500/60 focus:bg-slate-950/80 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50"
              />
              <button
                onClick={sendChat}
                disabled={status !== "online"}
                className="rounded-xl bg-emerald-500 px-6 py-2.5 font-bold text-emerald-950 shadow-[0_0_20px_-5px_rgba(16,185,129,0.4)] transition hover:bg-emerald-400 disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </>
        ) : (
          <BotScreen tab={tab} snap={snap} doAction={doAction} acting={acting} engine={bot.engine} beam={beam} />
        )}
      </div>
    </div>
  );
}

function BotScreen({
  tab,
  snap,
  doAction,
  acting,
  engine,
  beam,
}: {
  tab: string;
  snap: ViewSnapshot | null;
  doAction: (a: string, p?: any) => Promise<void>;
  acting: boolean;
  engine: string;
  beam: { looping: boolean; stage: string };
}) {
  const radar = useRef<HTMLCanvasElement>(null);

  // Keyboard shortcuts: 1-9 select slot, R = use/right-click.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (tab !== "screen") return;
      const t = (e.target as HTMLElement)?.tagName;
      if (t === "INPUT" || t === "TEXTAREA") return;
      if (e.key >= "1" && e.key <= "9") {
        doAction("select", { slot: Number(e.key) - 1 });
      } else if (e.key.toLowerCase() === "r") {
        doAction("use");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doAction, tab]);

  // Radar drawing logic
  useEffect(() => {
    const canvas = radar.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const RANGE = 32;
    const scale = Math.min(W, H) / 2 / RANGE;

    ctx.clearRect(0, 0, W, H);
    const sky = snap?.isDay ? "#0b1220" : "#05070d";
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "rgba(148,163,184,0.18)";
    ctx.lineWidth = 1;
    for (let r = 8; r <= RANGE; r += 8) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(56,189,248,0.10)";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const fov = (70 * Math.PI) / 180;
    ctx.arc(cx, cy, RANGE * scale, -Math.PI / 2 - fov / 2, -Math.PI / 2 + fov / 2);
    ctx.closePath();
    ctx.fill();

    if (snap?.nearbyBlocks) {
      ctx.fillStyle = "rgba(71,85,105,0.55)";
      for (const b of snap.nearbyBlocks) {
        const px = cx + b.right * scale;
        const py = cy - b.forward * scale;
        ctx.fillRect(px - 2, py - 2, 4, 4);
      }
    }

    if (snap?.entities) {
      for (const e of snap.entities) {
        const px = cx + e.right * scale;
        const py = cy - e.forward * scale;
        if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
        let color = "#94a3b8";
        if (e.kind === "player") color = "#34d399";
        else if (e.kind === "mob") color = "#f87171";
        else if (e.kind === "object") color = "#fbbf24";
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px, py, e.kind === "player" ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fill();
        if (e.kind === "player") {
          ctx.fillStyle = "#a7f3d0";
          ctx.font = "10px ui-monospace, monospace";
          ctx.fillText(e.name.slice(0, 12), px + 7, py + 3);
        }
      }
    }

    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx - 5, cy + 6);
    ctx.lineTo(cx + 5, cy + 6);
    ctx.closePath();
    ctx.fill();
  }, [snap]);

  if (!snap?.available) {
    return (
      <div className="grid h-full place-items-center px-6 py-20 text-center text-slate-500">
        <div className="text-4xl">🛰️</div>
        <p className="mt-3 max-w-sm text-sm">
          The bot must be online and spawned in the world to stream its view.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {snap.window ? (
        <div className="flex flex-1 flex-col items-center justify-center p-6">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-[#c6c6c6] p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between text-[#373737]">
              <h3 className="font-bold">{snap.window.title || "Container"}</h3>
              <button
                onClick={() => doAction("closeWindow")}
                className="rounded bg-rose-500 px-2 py-1 text-xs font-bold text-white shadow"
              >
                Close (X)
              </button>
            </div>
            <div className="grid grid-cols-9 gap-1">
              {snap.window.slots.map((it, idx) => (
                <button
                  key={idx}
                  disabled={acting || !it}
                  onClick={() => doAction("clickWindow", { slot: it?.slot })}
                  className="group relative grid h-10 w-10 place-items-center bg-[#8b8b8b] shadow-[inset_-2px_-2px_0_rgba(255,255,255,0.5),inset_2px_2px_0_rgba(55,55,55,0.5)] hover:bg-[#a6a6a6] disabled:opacity-80"
                >
                  {it?.name && <ItemIcon name={it.name} />}
                  {it && it.count > 1 && (
                    <span className="absolute bottom-0 right-0.5 text-[10px] font-bold text-white drop-shadow-md">
                      {it.count}
                    </span>
                  )}
                  {it && (
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 scale-95 whitespace-nowrap rounded border border-slate-700/80 bg-[#0f0f0f]/95 px-2.5 py-1.5 text-xs opacity-0 shadow-2xl backdrop-blur transition-all group-hover:scale-100 group-hover:opacity-100">
                      <span className="font-medium text-[#a855f7] drop-shadow-sm">{it.displayName}</span>
                      <span className="ml-2 font-mono text-[#94a3b8]">x{it.count}</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 p-6 sm:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center gap-3">
            {engine === "nmp" ? (
              <div className="flex h-[300px] w-[300px] flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/60 text-center shadow-inner">
                <span className="text-3xl">📡</span>
                <span className="mt-4 font-semibold text-slate-300">Raw NMP Mode</span>
                <span className="mt-2 max-w-[200px] text-xs text-slate-500">Radar and chunk processing disabled for stealth bypass.</span>
              </div>
            ) : (
              <canvas
                ref={radar}
                width={300}
                height={300}
                className="rounded-2xl border border-slate-800 bg-slate-950 shadow-inner"
              />
            )}
            
            {/* D-Pad Movement */}
            <div className="grid grid-cols-3 grid-rows-2 gap-1.5 pt-2">
              <div />
              <button
                disabled={acting}
                onClick={() => doAction("move", { dir: "forward" })}
                className="rounded-lg bg-slate-800 p-3 text-slate-300 transition hover:bg-slate-700 active:scale-95"
              >
                W
              </button>
              <div />
              <button
                disabled={acting}
                onClick={() => doAction("move", { dir: "left" })}
                className="rounded-lg bg-slate-800 p-3 text-slate-300 transition hover:bg-slate-700 active:scale-95"
              >
                A
              </button>
              <button
                disabled={acting}
                onClick={() => doAction("move", { dir: "back" })}
                className="rounded-lg bg-slate-800 p-3 text-slate-300 transition hover:bg-slate-700 active:scale-95"
              >
                S
              </button>
              <button
                disabled={acting}
                onClick={() => doAction("move", { dir: "right" })}
                className="rounded-lg bg-slate-800 p-3 text-slate-300 transition hover:bg-slate-700 active:scale-95"
              >
                D
              </button>
            </div>
          </div>

          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Health">❤️ {snap.health} / 20</Stat>
              <Stat label="Food">🍗 {snap.food} / 20</Stat>
              <Stat label="Location">
                {snap.position?.x ?? 0}, {snap.position?.y ?? 0}, {snap.position?.z ?? 0}
              </Stat>
              <Stat label="Looking at">
                {snap.lookingAt ? snap.lookingAt.name : "air"}
              </Stat>
            </div>
            
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Nearby Players & Mobs
              </h3>
              <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60 p-2 text-xs">
                {engine === "nmp" ? (
                   <p className="px-2 py-1 text-slate-600">Entity tracking disabled.</p>
                ) : snap.entities && snap.entities.length > 0 ? (
                  snap.entities.map((e, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 px-1">
                      <span className="flex items-center gap-2 truncate text-slate-300">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{
                            background:
                              e.kind === "player" ? "#34d399" : "#f87171",
                          }}
                        />
                        {e.name}
                      </span>
                      <span className="font-mono text-slate-500">
                        {e.distance}m
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="px-2 py-1 text-slate-600">None nearby</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hotbar */}
      <div className="mt-auto border-t border-white/5 bg-black/40 p-5">
        <div className="flex flex-wrap items-center gap-2">
          {(snap.hotbar ?? []).map((it) => (
            <button
              key={it.slot}
              onClick={() => doAction("select", { slot: it.slot })}
              disabled={acting}
              className={`group relative grid h-14 w-14 place-items-center rounded-xl border-2 transition disabled:opacity-60 ${
                it.selected
                  ? "border-emerald-400 bg-emerald-500/20 shadow-[0_0_15px_rgba(52,211,153,0.3)]"
                  : "border-slate-800 bg-slate-900 hover:border-slate-600"
              }`}
            >
              <span className="absolute left-1.5 top-1 text-[9px] font-bold text-slate-500">
                {it.slot + 1}
              </span>
              {it.name ? <ItemIcon name={it.name} /> : <span className="text-slate-700">·</span>}
              {it.count > 1 && (
                <span className="absolute bottom-1 right-1.5 text-xs font-bold text-white drop-shadow-md">
                  {it.count}
                </span>
              )}
              {it.name && (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-3 -translate-x-1/2 scale-95 whitespace-nowrap rounded-md border border-slate-700/80 bg-[#0f0f0f]/95 px-3 py-1.5 text-xs opacity-0 shadow-2xl backdrop-blur-md transition-all group-hover:scale-100 group-hover:opacity-100">
                  <span className="font-semibold text-white drop-shadow-sm">{it.displayName}</span>
                  <span className="ml-2 font-mono text-[#94a3b8]">x{it.count}</span>
                </div>
              )}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => doAction("use")}
              disabled={acting || !snap.heldItem}
              className="rounded-xl bg-emerald-500 px-5 py-3 text-sm font-bold text-emerald-950 shadow-[0_0_20px_-5px_rgba(16,185,129,0.4)] transition hover:bg-emerald-400 disabled:opacity-40"
            >
              Right-click / Use
            </button>
            <button
              onClick={() => doAction("drop")}
              disabled={acting || !snap.heldItem}
              className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm font-medium text-slate-300 transition hover:bg-slate-700 disabled:opacity-40"
            >
              Drop
            </button>
            <div className="mx-2 h-8 w-px bg-slate-800"></div>
            {beam?.looping ? (
              <button
                onClick={() => doAction("beam_stop")}
                disabled={acting}
                className="rounded-xl bg-rose-500 px-5 py-3 text-sm font-bold text-rose-950 shadow-[0_0_20px_-5px_rgba(244,63,94,0.4)] transition hover:bg-rose-400 disabled:opacity-40"
              >
                ⏹ Stop Beam
              </button>
            ) : (
              <button
                onClick={() => doAction("beam_start")}
                disabled={acting || !snap.available}
                className="rounded-xl bg-fuchsia-500 px-5 py-3 text-sm font-bold text-fuchsia-950 shadow-[0_0_20px_-5px_rgba(217,70,239,0.4)] transition hover:bg-fuchsia-400 disabled:opacity-40"
              >
                📡 Start Beam
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 truncate font-semibold text-slate-200">
        {children}
      </div>
    </div>
  );
}

const ITEM_IMG_VERSION = "1.21.4";
function itemImageUrl(name: string, dir: "item" | "block"): string {
  // Handle some common mismatches between mineflayer names and vanilla texture names
  let cleanName = name.replace("spear", "trident"); // map custom spears to trident
  if (cleanName === "glass_pane") cleanName = "white_stained_glass_pane"; // default pane texture
  if (cleanName.endsWith("_pane") && dir === "block") {
    // pane blocks use the solid glass texture in assets often
    cleanName = cleanName.replace("_pane", "");
  }
  return `https://assets.mcasset.cloud/${ITEM_IMG_VERSION}/assets/minecraft/textures/${dir}/${cleanName}.png`;
}

function ItemIcon({ name }: { name: string }) {
  const [stage, setStage] = useState<0 | 1 | 2 | 3>(0);

  // Stage 0: try "item" texture
  // Stage 1: try "block" texture
  // Stage 2: try generic fallback (apple for food, sword for weapons, etc)
  // Stage 3: Letter fallback
  
  const getUrl = () => {
    if (stage === 0) return itemImageUrl(name, "item");
    if (stage === 1) return itemImageUrl(name, "block");
    
    // Stage 2 semantic fallbacks
    if (name.includes("sword") || name.includes("blade") || name.includes("spear")) return itemImageUrl("iron_sword", "item");
    if (name.includes("potion")) return itemImageUrl("potion", "item");
    if (name.includes("helmet")) return itemImageUrl("iron_helmet", "item");
    if (name.includes("chestplate")) return itemImageUrl("iron_chestplate", "item");
    if (name.includes("leggings")) return itemImageUrl("iron_leggings", "item");
    if (name.includes("boots")) return itemImageUrl("iron_boots", "item");
    
    return ""; // force stage 3
  };

  if (stage === 3) {
    const letter = name.replace(/[^a-zA-Z]/g, "").charAt(0).toUpperCase() || "?";
    return (
      <div className="grid h-8 w-8 place-items-center rounded bg-slate-800 text-sm font-bold text-slate-300 shadow-inner">
        {letter}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={getUrl()}
      alt={name}
      width={32}
      height={32}
      onError={() => setStage((s) => (s + 1) as 0 | 1 | 2 | 3)}
      style={{ imageRendering: "pixelated" }}
      className="h-8 w-8 object-contain drop-shadow-md"
    />
  );
}

function logColor(level: LogEntry["level"]) {
  switch (level) {
    case "error":
      return "text-rose-400";
    case "system":
      return "text-sky-400";
    case "chat":
      return "text-slate-200";
    default:
      return "text-slate-400";
  }
}

function whisperKind(line: string): "from" | "to" | null {
  const l = line.toLowerCase();
  if (/<you\s*→/.test(line)) return null;
  if (/\(from\b/.test(l) || /^\s*from\s+\w+/.test(l) || /whispers to you/.test(l))
    return "from";
  if (/\(to\b/.test(l) || /\byou whisper to\b/.test(l)) return "to";
  return null;
}
