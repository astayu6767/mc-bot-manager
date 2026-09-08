"use client";

import { useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Add-bot wizard (quick flow for everyone):
//   1. paste session ID -> the account's IGN is fetched and shown
//   2. pick a server   (minemen.club / mcpvp.club, with their icons)
//   3. pick a proxy    (eu / as / na)
//   4. pick beaming mode:
//      - 1v1 Player Method -> opener script (editable default) + discord
//      - Adbot (standing)  -> lobby message, trigger word, reply message
//   5. create & connect (engine defaults to azalea)
// The old advanced form lives in the admin-only "Add Bots" tab.
// ---------------------------------------------------------------------------

type Profile = { name: string; id: string };

const SERVERS = [
  {
    id: "minemen",
    domain: "minemen.club",
    label: "Minemen Club",
    accent: "from-fuchsia-500/20 to-purple-500/5",
    ring: "ring-fuchsia-500/40",
    text: "text-fuchsia-300",
    iconHost: "eu.minemen.club",
  },
  {
    id: "mcpvp",
    domain: "mcpvp.club",
    label: "MCPVP Club",
    accent: "from-rose-500/20 to-red-500/5",
    ring: "ring-rose-500/40",
    text: "text-rose-300",
    iconHost: "eu.mcpvp.club",
  },
];

const REGIONS = [
  { id: "eu", label: "EU", blurb: "Europe proxy" },
  { id: "as", label: "AS", blurb: "Asia proxy" },
  { id: "na", label: "NA", blurb: "North America proxy" },
];

const BEAM_MODES = [
  {
    id: "ai",
    title: "1v1 Player Method",
    blurb:
      "Joins matches, chats with AI to recruit a teammate, gets their discord.",
    icon: "⚔️",
  },
  {
    id: "lobby",
    title: "Adbot (Standing Method)",
    blurb:
      "Stays in the lobby, advertises the trigger word, whispers repliers.",
    icon: "📣",
  },
];

const DEFAULT_OPENER =
  "yo\nsup, could you help me ?\ncause im in a 2v2 event and i need a teamate ;[";

const STEP_LABELS = ["Session", "Server", "Proxy", "Beaming", "Setup"];

export default function AddBotWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState(0);
  const [token, setToken] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [checking, setChecking] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [serverId, setServerId] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [beamMode, setBeamMode] = useState<string | null>(null);
  // 1v1 method config
  const [opener, setOpener] = useState(DEFAULT_OPENER);
  const [discordUser, setDiscordUser] = useState("");
  // adbot config
  const [lobbyMsg, setLobbyMsg] = useState("type 123 in chat for tier test all mode");
  const [triggerWord, setTriggerWord] = useState("123");
  const [replyMsg, setReplyMsg] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const server = SERVERS.find((s) => s.id === serverId) ?? null;

  function onTokenChange(v: string) {
    setToken(v);
    setProfile(null);
    setSessionError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const val = v.trim();
    if (!val) return;
    debounceRef.current = setTimeout(() => void checkSession(val), 500);
  }

  async function checkSession(val: string) {
    setChecking(true);
    setSessionError(null);
    try {
      const res = await fetch("/api/bots/resolve-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: val }),
      });
      const data = await res.json();
      if (!res.ok) {
        setProfile(null);
        setSessionError(data.error ?? "Could not verify this session ID");
      } else {
        setProfile({ name: data.name, id: data.id });
      }
    } catch {
      setSessionError("Network error while checking the session ID");
    } finally {
      setChecking(false);
    }
  }

  async function create() {
    if (!profile || !server || !region || !beamMode) return;
    setCreating(true);
    setCreateError(null);
    try {
      const payload: Record<string, unknown> = {
        name: profile.name,
        token: token.trim(),
        host: `${region}.${server.domain}`,
        port: 25565,
        version: "auto",
        engine: "azalea",
        beamType: beamMode,
      };
      if (beamMode === "ai") {
        payload.openerScript = opener;
        payload.discordUser = discordUser.trim();
      } else {
        payload.spamMessage = lobbyMsg;
        payload.spamTriggerWord = triggerWord;
        payload.spamReplyMessage = replyMsg;
      }
      const res = await fetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error ?? "Failed to create bot");
        return;
      }
      onCreated();
    } catch {
      setCreateError("Network error while creating bot");
    } finally {
      setCreating(false);
    }
  }

  function canNext(): boolean {
    if (step === 0) return profile !== null;
    if (step === 1) return serverId !== null;
    if (step === 2) return region !== null;
    if (step === 3) return beamMode !== null;
    return true;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 animate-fade-in bg-[#030712]/80 backdrop-blur-xl"
        onClick={onClose}
      />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 flex w-full animate-pop-in justify-center"
      >
        <div className="absolute -inset-1 z-[-1] rounded-[2rem] bg-gradient-to-b from-emerald-500/20 to-indigo-500/10 opacity-60 blur-xl" />
        <div className="premium-modal flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-[24px]">
          {/* header */}
          <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] px-6 py-5">
            <div className="flex items-center gap-4">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 text-xl shadow-[0_0_20px_-5px_rgba(16,185,129,0.5)]">
                ＋
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white">
                  Add a bot
                </h2>
                <p className="text-xs font-medium text-slate-400">
                  Session ID → server → proxy → beaming mode
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-full bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-white"
            >
              ✕
            </button>
          </div>

          {/* step dots */}
          <div className="flex items-center gap-2 border-b border-white/5 px-6 py-3">
            {STEP_LABELS.map((label, i) => (
              <div key={label} className="flex flex-1 items-center gap-2">
                <div
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold transition ${
                    i < step
                      ? "bg-emerald-500/20 text-emerald-300"
                      : i === step
                        ? "bg-emerald-500 text-emerald-950"
                        : "bg-slate-800 text-slate-500"
                  }`}
                >
                  {i < step ? "✓" : i + 1}
                </div>
                <span
                  className={`hidden text-xs font-medium sm:block ${
                    i === step ? "text-slate-200" : "text-slate-500"
                  }`}
                >
                  {label}
                </span>
                {i < STEP_LABELS.length - 1 && (
                  <div
                    className={`h-px flex-1 ${i < step ? "bg-emerald-500/40" : "bg-slate-800"}`}
                  />
                )}
              </div>
            ))}
          </div>

          {/* body */}
          <div className="flex-1 overflow-y-auto p-6">
            {step === 0 && (
              <div className="space-y-4">
                <Field label="Session ID">
                  <textarea
                    value={token}
                    onChange={(e) => onTokenChange(e.target.value)}
                    placeholder="Paste your session ID…"
                    rows={3}
                    className={`${inputClass} resize-none font-mono text-xs`}
                  />
                </Field>
                {checking && (
                  <p className="flex items-center gap-2 text-sm text-slate-400">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-600 border-t-emerald-400" />
                    Checking session…
                  </p>
                )}
                {sessionError && (
                  <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300 ring-1 ring-rose-500/20">
                    {sessionError}
                  </p>
                )}
                {profile && (
                  <div className="flex items-center gap-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                    <HeadAvatar name={profile.name} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-lg font-bold text-white">
                          {profile.name}
                        </span>
                        <span className="text-emerald-400">✓</span>
                      </div>
                      <div className="truncate font-mono text-[11px] text-slate-400">
                        {profile.id}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {step === 1 && (
              <div className="grid grid-cols-2 gap-3">
                {SERVERS.map((s) => {
                  const on = serverId === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setServerId(s.id)}
                      className={`flex flex-col items-center gap-3 rounded-2xl border bg-gradient-to-b p-5 transition ${s.accent} ${
                        on
                          ? `border-white/20 ring-2 ${s.ring}`
                          : "border-slate-700/80 hover:border-slate-500"
                      }`}
                    >
                      <ServerLogo key={s.iconHost} host={s.iconHost} label={s.label} />
                      <div className="text-center">
                        <div className="text-sm font-bold text-white">
                          {s.domain}
                        </div>
                        <div className={`text-[11px] font-medium ${s.text}`}>
                          {s.label}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {step === 2 && (
              <div className="grid grid-cols-3 gap-3">
                {REGIONS.map((r) => {
                  const on = region === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setRegion(r.id)}
                      className={`rounded-xl border px-3 py-4 text-center transition ${
                        on
                          ? "border-emerald-500/50 bg-emerald-500/10 ring-1 ring-emerald-500/30"
                          : "border-slate-700/80 bg-slate-950/60 hover:border-slate-500"
                      }`}
                    >
                      <div className="text-lg font-bold text-white">{r.label}</div>
                      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                        {r.blurb}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {step === 3 && (
              <div className="grid gap-2">
                {BEAM_MODES.map((m) => {
                  const on = beamMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setBeamMode(m.id)}
                      className={`rounded-xl border px-3.5 py-3 text-left transition ${
                        on
                          ? "border-emerald-500/50 bg-emerald-500/10 ring-1 ring-emerald-500/30"
                          : "border-slate-700/80 bg-slate-950/60 hover:border-slate-500"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-lg">{m.icon}</span>
                        <span className="text-sm font-semibold text-slate-100">
                          {m.title}
                        </span>
                        {on && (
                          <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-emerald-400">
                            selected
                          </span>
                        )}
                      </div>
                      <span className="mt-1 block pl-7 text-xs text-slate-400">
                        {m.blurb}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {step === 4 && beamMode === "ai" && (
              <div className="space-y-4">
                <Field
                  label="Opener script"
                  hint="One message per line — the bot sends these to the teammate it finds. Edit freely."
                >
                  <textarea
                    value={opener}
                    onChange={(e) => setOpener(e.target.value)}
                    rows={4}
                    className={`${inputClass} resize-none`}
                  />
                </Field>
                <Field
                  label="Your Discord username"
                  hint="The bot asks the teammate to add this on discord."
                >
                  <input
                    value={discordUser}
                    onChange={(e) => setDiscordUser(e.target.value)}
                    placeholder="your discord"
                    className={inputClass}
                  />
                </Field>
              </div>
            )}

            {step === 4 && beamMode === "lobby" && (
              <div className="space-y-4">
                <Field
                  label="Lobby message"
                  hint="Sent in the lobby periodically — advertises the trigger word."
                >
                  <textarea
                    value={lobbyMsg}
                    onChange={(e) => setLobbyMsg(e.target.value)}
                    rows={2}
                    className={`${inputClass} resize-none`}
                  />
                </Field>
                <Field label="Trigger word">
                  <input
                    value={triggerWord}
                    onChange={(e) => setTriggerWord(e.target.value)}
                    placeholder="123"
                    className={inputClass}
                  />
                </Field>
                <Field
                  label="Reply message"
                  hint="Whispered ~10s after someone says the trigger word."
                >
                  <textarea
                    value={replyMsg}
                    onChange={(e) => setReplyMsg(e.target.value)}
                    rows={2}
                    placeholder="add my discord to join"
                    className={`${inputClass} resize-none`}
                  />
                </Field>
              </div>
            )}

            {step === 4 && server && region && (
              <div className="mt-5 rounded-xl border border-slate-700/80 bg-slate-950/60 p-4 text-sm">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Summary
                </div>
                <ul className="space-y-1.5 text-slate-300">
                  <li>
                    Account: <b className="text-white">{profile?.name}</b>
                  </li>
                  <li>
                    Server:{" "}
                    <b className="text-white">
                      {region}.{server.domain}
                    </b>
                  </li>
                  <li>
                    Mode:{" "}
                    <b className="text-white">
                      {BEAM_MODES.find((m) => m.id === beamMode)?.title}
                    </b>
                  </li>
                </ul>
              </div>
            )}

            {step === 4 && createError && (
              <p className="mt-4 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300 ring-1 ring-rose-500/20">
                {createError}
              </p>
            )}
          </div>

          {/* footer */}
          <div className="flex items-center justify-between gap-3 border-t border-white/5 bg-black/20 p-5">
            <button
              onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
              className="rounded-xl border border-white/10 px-5 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/5 hover:text-white"
            >
              {step === 0 ? "Cancel" : "← Back"}
            </button>
            {step < 4 ? (
              <button
                onClick={() => canNext() && setStep(step + 1)}
                disabled={!canNext() || checking}
                className="rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-500 px-5 py-2.5 text-sm font-bold text-emerald-950 shadow-[0_0_20px_-5px_rgba(16,185,129,0.4)] transition hover:from-emerald-300 hover:to-emerald-400 disabled:opacity-40"
              >
                Next
              </button>
            ) : (
              <button
                onClick={() => void create()}
                disabled={creating}
                className="rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-500 px-5 py-2.5 text-sm font-bold text-emerald-950 shadow-[0_0_20px_-5px_rgba(16,185,129,0.4)] transition hover:from-emerald-300 hover:to-emerald-400 disabled:opacity-40"
              >
                {creating ? "Creating…" : "Create & connect"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Player head avatar with graceful fallback to initials.
function HeadAvatar({ name }: { name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 text-lg font-bold text-white">
        {name.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://mc-heads.net/avatar/${encodeURIComponent(name)}/64`}
      alt={name}
      onError={() => setFailed(true)}
      className="h-14 w-14 shrink-0 rounded-xl ring-1 ring-white/10"
    />
  );
}

// Server icon straight from the live server ping (what the multiplayer
// screen shows). Falls back to a clean wordmark tile if unreachable.
function ServerLogo({ host, label }: { host: string; label: string }) {
  const [stage, setStage] = useState(0);
  const sources = [
    `https://api.mcsrvstat.us/3/icon/${host}`,
    `https://api.mcstatus.io/v2/icon/${host}`,
  ];
  if (stage >= sources.length) {
    return (
      <div className="grid h-14 w-14 place-items-center rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 text-xl font-black text-white ring-1 ring-white/10">
        {label.slice(0, 1)}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={sources[stage]}
      alt={label}
      onError={() => setStage(stage + 1)}
      className="h-14 w-14 rounded-xl ring-1 ring-white/10 [image-rendering:pixelated]"
    />
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-300">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-slate-700/80 bg-slate-950/60 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 outline-none transition focus:border-emerald-500/60 focus:bg-slate-950/80 focus:ring-2 focus:ring-emerald-500/20";
