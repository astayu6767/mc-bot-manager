"use client";

import { useState } from "react";

type Plan = {
  id: string;
  tier: string;
  price: number;
  bots: number;
  hours: number;
  popular?: boolean;
  features: string[];
  cta: string;
  accent: string;
};

const PLANS: Plan[] = [
  {
    id: "basic",
    tier: "STARTER",
    price: 5,
    bots: 2,
    hours: 6,
    features: [
      "2 concurrent bots",
      "6 bot-hours / day",
      "Basic telemetry & logs",
      "Standard beaming speed",
      "Community Discord support",
      "Monthly billing",
    ],
    cta: "Get started",
    accent: "from-slate-700 to-slate-800",
  },
  {
    id: "pro",
    tier: "PRO",
    price: 8,
    bots: 5,
    hours: 12,
    popular: true,
    features: [
      "5 concurrent bots",
      "12 bot-hours / day",
      "Full analytics & live console",
      "Advanced scanner & priority queue",
      "All plugins included",
      "Fast beaming speed",
      "Priority Discord support",
      "Monthly billing",
    ],
    cta: "Get started",
    accent: "from-indigo-600 to-blue-600",
  },
  {
    id: "ultra",
    tier: "ENTERPRISE",
    price: 15,
    bots: 15,
    hours: 24,
    features: [
      "15 concurrent bots",
      "24 bot-hours / day",
      "Full analytics & live console",
      "Custom behaviors & API access",
      "All plugins included",
      "Maximum beaming speed",
      "Early access to new features",
      "Dedicated 1:1 support",
      "Monthly billing",
    ],
    cta: "Get started",
    accent: "from-amber-500 to-orange-600",
  },
];

export default function ShopPanel({ onGoLicense }: { onGoLicense?: () => void }) {
  const [toast, setToast] = useState<string | null>(null);

  function handleBuy(plan: Plan) {
    const msg = `You selected ${plan.tier} $${plan.price}/mo – contact admin on Discord to get a license key like abeam-key-xxxx-xxxx, then redeem in License tab.`;
    setToast(msg);
    setTimeout(() => setToast(null), 5000);
    if (onGoLicense) {
      // small delay so toast is seen
      setTimeout(() => onGoLicense(), 800);
    }
  }

  return (
    <div className="relative">
      {/* soft background glows */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-[-80px] h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-indigo-600/20 blur-[120px]" />
        <div className="absolute right-[10%] top-[200px] h-[300px] w-[300px] rounded-full bg-amber-500/10 blur-[100px]" />
        <div className="absolute left-[10%] bottom-[-80px] h-[300px] w-[300px] rounded-full bg-emerald-500/10 blur-[100px]" />
      </div>

      <div className="flex items-start gap-4">
        <div className="relative grid h-11 w-11 place-items-center rounded-[14px] bg-gradient-to-br from-violet-500 via-indigo-500 to-blue-600 shadow-[0_8px_24px_rgba(99,102,241,0.35)] ring-1 ring-white/10">
          <ShopBagIcon />
          <div className="absolute inset-0 rounded-[14px] bg-gradient-to-tr from-white/20 to-transparent" />
        </div>
        <div className="flex-1">
          <h2 className="text-[22px] font-bold tracking-tight text-white">Shop</h2>
          <p className="mt-1 max-w-[560px] text-[13px] leading-relaxed text-slate-400">
            Pick a plan that fits your grind. All plans give you redeemable license keys
            <span className="mx-1 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-amber-300 ring-1 ring-amber-500/20">abeam-key-xxxx-xxxx</span>
            to unlock bot slots instantly.
          </p>
        </div>
      </div>

      {/* current info pill */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-3.5 py-2 text-xs text-slate-300 backdrop-blur">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)] animate-pulse" />
          Secure checkout via admin · Instant delivery · Cancel anytime
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1.5 text-[11px] font-medium text-indigo-300">
          <span>⚡</span> Most users pick PRO $8
        </div>
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className={`group relative flex flex-col rounded-[22px] p-[1px] transition-all duration-300 hover:-translate-y-1 ${
              plan.popular
                ? "bg-gradient-to-b from-violet-500/60 via-indigo-500/50 to-blue-500/40 shadow-[0_0_40px_rgba(99,102,241,0.25)]"
                : "bg-gradient-to-b from-slate-700/40 to-slate-800/40 hover:from-slate-600/50 hover:to-slate-700/50"
            }`}
          >
            {plan.popular && (
              <div className="absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1/2">
                <div className="rounded-full bg-gradient-to-r from-indigo-500 to-blue-500 px-3.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white shadow-[0_4px_16px_rgba(99,102,241,0.4)] ring-1 ring-white/20">
                  Most Popular
                </div>
              </div>
            )}

            <div className="relative flex flex-1 flex-col rounded-[21px] bg-[#0e1220]/90 p-6 backdrop-blur-xl">
              {/* subtle inner glow for popular */}
              {plan.popular && (
                <div className="pointer-events-none absolute inset-0 rounded-[21px] bg-gradient-to-br from-indigo-500/[0.12] via-transparent to-blue-500/[0.08]" />
              )}

              <div className="relative">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                    {plan.tier}
                  </span>
                  {plan.popular && (
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/20">
                      ★
                    </span>
                  )}
                </div>

                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-4xl font-bold tracking-tight text-white">
                    ${plan.price}
                  </span>
                  <span className="text-sm font-medium text-slate-500">/mo</span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-900/60 p-2 ring-1 ring-slate-800/80">
                  <div className="rounded-xl bg-slate-950/60 px-3 py-2.5 text-center ring-1 ring-slate-800/50">
                    <div className="text-[18px] font-bold leading-none text-white">{plan.bots}</div>
                    <div className="mt-1 text-[10px] font-medium uppercase tracking-widest text-slate-500">Bots</div>
                  </div>
                  <div className="rounded-xl bg-slate-950/60 px-3 py-2.5 text-center ring-1 ring-slate-800/50">
                    <div className="text-[18px] font-bold leading-none text-white">{plan.hours}h</div>
                    <div className="mt-1 text-[10px] font-medium uppercase tracking-widest text-slate-500">Hours</div>
                  </div>
                </div>

                <div className="mt-6 space-y-3">
                  {plan.features.map((f, i) => (
                    <div key={i} className="flex items-start gap-2.5 text-[13px] leading-[1.4] text-slate-300">
                      <span
                        className={`mt-[2px] grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${
                          plan.popular
                            ? "bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/20"
                            : "bg-slate-800 text-slate-400 ring-1 ring-slate-700/50"
                        }`}
                      >
                        ✓
                      </span>
                      <span className={f.includes("Maximum") || f.includes("Fast") || f.includes("Full") ? "font-medium text-slate-200" : ""}>
                        {f}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-auto pt-8">
                <button
                  onClick={() => handleBuy(plan)}
                  className={`relative w-full overflow-hidden rounded-xl px-4 py-3.5 text-sm font-bold transition-all active:scale-[0.98] ${
                    plan.popular
                      ? "bg-gradient-to-r from-indigo-500 to-blue-600 text-white shadow-[0_8px_24px_rgba(99,102,241,0.35)] hover:from-indigo-400 hover:to-blue-500 hover:shadow-[0_12px_32px_rgba(99,102,241,0.45)]"
                      : "border border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-600 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  <span className="relative z-10">{plan.cta}</span>
                  {plan.popular && (
                    <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/15 to-white/0 opacity-0 transition-opacity group-hover:opacity-100" />
                  )}
                </button>

                <p className="mt-3 text-center text-[11px] text-slate-500">
                  License key format: <span className="font-mono text-slate-400">abeam-key-xxxx-xxxx</span>
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* bottom help */}
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 backdrop-blur">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20">🔒</span>
            Instant redeem
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">Buy → get key → redeem in License tab. Slots added immediately, no restart needed.</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 backdrop-blur">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-500/10 text-indigo-300 ring-1 ring-indigo-500/20">⚡</span>
            Smooth & fast
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">Modern UI, Azalea + Mineflayer + NMP engines, live console, radar, hotbar control.</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 backdrop-blur">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/20">💬</span>
            Need custom?
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">Need 30+ bots or lifetime? DM admin – custom license keys available.</p>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 w-[90%] max-w-[560px] -translate-x-1/2 animate-pop-in rounded-2xl border border-indigo-500/30 bg-slate-900/90 p-4 shadow-2xl backdrop-blur-xl">
          <div className="flex gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-500/20 text-indigo-300">🎫</div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-white">How to get your key</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">{toast}</p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setToast(null)}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
                >
                  Got it
                </button>
                <button
                  onClick={() => setToast(null)}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ShopBagIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 01-8 0" />
    </svg>
  );
}
