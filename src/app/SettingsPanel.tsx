"use client";

import { Logo } from "./Logo";
import {
  GearIcon,
  BotFaceIcon,
  MessageIcon,
  TargetIcon,
  EyeIcon,
} from "./Icons";

type Me = {
  id: string;
  username: string;
  avatar: string | null;
  role: string;
  botSlots: number;
  botCount: number;
  isGuest: boolean;
};

export default function SettingsPanel({
  me,
  onChange,
}: {
  me: Me;
  onChange: () => void;
}) {
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    onChange();
  }

  return (
    <div className="relative space-y-6">
      {/* background glow — matches the other pages */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-[-40px] top-[-40px] h-[240px] w-[240px] rounded-full bg-slate-500/[0.08] blur-[80px]" />
        <div className="absolute right-[-20px] top-[100px] h-[180px] w-[180px] rounded-full bg-emerald-400/[0.06] blur-[80px]" />
      </div>

      <div className="flex items-center gap-3">
        <div className="relative">
          <div className="absolute inset-0 rounded-[14px] bg-gradient-to-br from-slate-400 to-slate-600 blur-[12px] opacity-40" />
          <div className="relative grid h-11 w-11 place-items-center rounded-[14px] bg-gradient-to-br from-slate-500 to-slate-700 text-white shadow-lg ring-1 ring-white/10">
            <GearIcon size={22} />
          </div>
        </div>
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white">
            Settings
          </h2>
          <p className="text-sm text-slate-400">
            Your account and app preferences.
          </p>
        </div>
      </div>

      {/* Profile card */}
      <section className="glass rounded-2xl p-5 transition-colors hover:border-slate-700">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Account
        </h3>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          {me.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={me.avatar}
              alt=""
              className="h-16 w-16 rounded-2xl ring-2 ring-slate-700"
            />
          ) : (
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 text-xl font-bold">
              {me.username.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-white">
                {me.username}
              </span>
              {me.role === "admin" && (
                <span className="rounded-md bg-fuchsia-500/15 px-2 py-0.5 text-xs font-medium text-fuchsia-300 ring-1 ring-fuchsia-500/30">
                  admin
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-slate-400">
              {me.isGuest ? "Guest account" : "Signed in with Discord"}
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <InfoTile label="Role" value={me.role} />
          <InfoTile label="Bot slots" value={String(me.botSlots)} />
          <InfoTile label="Bots used" value={`${me.botCount}/${me.botSlots}`} />
        </div>
      </section>

      {/* Beam AI info */}
      <section className="glass rounded-2xl p-5 transition-colors hover:border-slate-700">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Beam &amp; AI
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          The Beam feature finds the nearest player, recruits them with private
          messages, handles their replies with AI, and closes with your discord
          when they agree. Pick the beaming mode when creating each bot.
        </p>
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          <FeatureRow
            icon={<BotFaceIcon size={18} />}
            title="Humanized behavior"
            desc="Natural message pacing + timing variance"
          />
          <FeatureRow
            icon={<MessageIcon size={18} />}
            title="AI conversations"
            desc="In-character replies that stay on script"
          />
          <FeatureRow
            icon={<TargetIcon size={18} />}
            title="Smart targeting"
            desc="Nearest valid player, auto-restart on deny"
          />
          <FeatureRow
            icon={<EyeIcon size={18} />}
            title="Live bot view"
            desc="Radar, hotbar, and item control"
          />
        </div>
      </section>

      {/* Danger / session */}
      <section className="glass rounded-2xl p-5 transition-colors hover:border-rose-500/20">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Session
        </h3>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-slate-400">
            Sign out of this device. You can sign back in anytime.
          </p>
          <button
            onClick={logout}
            className="shrink-0 rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300 active:scale-[0.98]"
          >
            Logout
          </button>
        </div>
      </section>

      <div className="flex items-center justify-center gap-2 pt-2 text-xs text-slate-600">
        <Logo size={18} /> MC Bot Manager
      </div>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3 transition-colors hover:border-slate-700">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-[15px] font-semibold capitalize text-slate-100">
        {value}
      </div>
    </div>
  );
}

function FeatureRow({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-700">
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20">
        {icon}
      </span>
      <div>
        <div className="text-sm font-medium text-slate-200">{title}</div>
        <div className="mt-0.5 text-xs text-slate-500">{desc}</div>
      </div>
    </div>
  );
}
