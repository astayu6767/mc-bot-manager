"use client";

import { useState } from "react";
import { PlusIcon } from "./Icons";
import { AddBotModal } from "./BotDashboard";

// Admin-only area: add bots with the full advanced form (the "old model" —
// every field: token, host, port, version, proxy, discord, engine).
// The regular Bots tab uses the quick wizard (session id → server → proxy).
export default function AdminAddBotPanel() {
  const [open, setOpen] = useState(false);
  const [createdCount, setCreatedCount] = useState(0);

  return (
    <div className="animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Add Bots
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Admin area — full control over every field when creating a bot.
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-500 px-5 py-2.5 text-sm font-bold text-emerald-950 shadow-[0_0_20px_-5px_rgba(16,185,129,0.4)] transition hover:from-emerald-300 hover:to-emerald-400"
        >
          <PlusIcon size={15} /> Add bot (advanced)
        </button>
      </div>

      <section className="mt-6 space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-sm leading-relaxed text-slate-300">
        <h2 className="text-base font-semibold text-white">
          Advanced form vs quick wizard
        </h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <b className="text-white">This page</b> opens the full form —
            Minecraft token, custom server IP &amp; port, pinned version, SOCKS
            proxy, discord user and engine. Use it for servers beyond
            the quick picks or when you need a proxy.
          </li>
          <li>
            The <b className="text-white">Bots</b> tab (everyone) has the quick
            wizard: paste a session ID, it shows the account&apos;s IGN, then
            pick engine → server → proxy region.
          </li>
          <li>
            Bots created here land on the <b className="text-white">Bots</b>{" "}
            tab of your own account, same as before.
          </li>
        </ul>
        {createdCount > 0 && (
          <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-emerald-300 ring-1 ring-emerald-500/20">
            ✓ {createdCount} bot{createdCount === 1 ? "" : "s"} created — see
            them on the Bots tab.
          </p>
        )}
      </section>

      {open && (
        <AddBotModal
          onClose={() => setOpen(false)}
          onCreated={() => {
            setOpen(false);
            setCreatedCount((c) => c + 1);
          }}
        />
      )}
    </div>
  );
}
