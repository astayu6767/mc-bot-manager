"use client";

import { useCallback, useEffect, useState } from "react";

type Plan = {
  id: string;
  tier: string;
  price: number;
  finalPrice?: number;
  bots: number;
  hours: number;
  features: string[];
  popular: boolean;
  active: boolean;
  discount: number;
};

type Invoice = {
  id: string;
  planId: string;
  amountUSD: number;
  amountLTC: string;
  ltcAddress: string;
  ownerLtcAddress: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  tier?: string;
  bots?: number;
  hours?: number;
};

export default function ShopPanel({ onGoLicense }: { onGoLicense?: () => void }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [checking, setChecking] = useState(false);
  const [paidInfo, setPaidInfo] = useState<{ licenseKey: string; bots: number; tier: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<string>("");

  const fetchPlans = useCallback(async () => {
    try {
      const res = await fetch("/api/shop/plans", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setPlans(data.plans || []);
      }
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  // countdown for invoice expiry
  useEffect(() => {
    if (!invoice) return;
    const interval = setInterval(() => {
      const exp = new Date(invoice.expiresAt).getTime();
      const now = Date.now();
      const diff = exp - now;
      if (diff <= 0) {
        setTimeLeft("Expired");
        return;
      }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${m}m ${s}s`);
    }, 1000);
    return () => clearInterval(interval);
  }, [invoice]);

  // poll payment status when invoice is pending
  useEffect(() => {
    if (!invoice || paidInfo) return;
    if (invoice.status !== "pending") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/shop/invoices/${invoice.id}/check`, { method: "POST" });
        const data = await res.json();
        if (data.paid) {
          setPaidInfo({ licenseKey: data.licenseKey, bots: data.bots, tier: data.tier });
          setInvoice(prev => prev ? { ...prev, status: "paid" } : prev);
          clearInterval(interval);
        }
      } catch {}
    }, 8000);
    return () => clearInterval(interval);
  }, [invoice, paidInfo]);

  async function handleBuy(plan: Plan) {
    // Check login properly - ain't bypassable, server will enforce
    setBuying(plan.id);
    try {
      const meRes = await fetch("/api/auth/me", { cache: "no-store" });
      const meData = await meRes.json();
      if (!meData.user) {
        setToast("Please login properly to purchase – auth required.");
        setTimeout(() => setToast(null), 4000);
        return;
      }
      // Create invoice
      const res = await fetch("/api/shop/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast(data.error || "Failed to create invoice");
        setTimeout(() => setToast(null), 4000);
        return;
      }
      setInvoice(data.invoice);
      setPaidInfo(null);
    } catch {
      setToast("Network error creating invoice");
      setTimeout(() => setToast(null), 4000);
    } finally {
      setBuying(null);
    }
  }

  async function checkPaymentNow() {
    if (!invoice) return;
    setChecking(true);
    try {
      const res = await fetch(`/api/shop/invoices/${invoice.id}/check`, { method: "POST" });
      const data = await res.json();
      if (data.paid) {
        setPaidInfo({ licenseKey: data.licenseKey, bots: data.bots, tier: data.tier });
        setInvoice(prev => prev ? { ...prev, status: "paid" } : prev);
      } else {
        setToast(`Not paid yet – balance: ${data.balance || "0"} LTC. Send exact amount.`);
        setTimeout(() => setToast(null), 3000);
      }
    } catch {
      setToast("Failed to check payment");
      setTimeout(() => setToast(null), 3000);
    } finally {
      setChecking(false);
    }
  }

  async function cancelInvoice() {
    if (!invoice) return;
    try {
      await fetch(`/api/shop/invoices/${invoice.id}`, { method: "DELETE" });
    } catch {}
    setInvoice(null);
    setPaidInfo(null);
  }

  function copy(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  function downloadTxt() {
    if (!paidInfo) return;
    const content = `License Key: ${paidInfo.licenseKey}\nPlan: ${paidInfo.tier}\nBots: ${paidInfo.bots}\nRedeem in License tab: enter the key to unlock slots.\nGenerated: ${new Date().toISOString()}\n`;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${paidInfo.licenseKey}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function autoRedeem() {
    if (!paidInfo) return;
    try {
      const res = await fetch("/api/licenses/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: paidInfo.licenseKey }),
      });
      const data = await res.json();
      if (res.ok) {
        setToast(`Redeemed! Got ${data.license.slots} slots`);
        setTimeout(() => {
          setToast(null);
          setInvoice(null);
          setPaidInfo(null);
          if (onGoLicense) onGoLicense();
        }, 1500);
      } else {
        setToast(data.error || "Redeem failed");
        setTimeout(() => setToast(null), 3000);
      }
    } catch {
      setToast("Network error redeeming");
      setTimeout(() => setToast(null), 3000);
    }
  }

  if (!loaded) {
    return (
      <div className="grid place-items-center py-16">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-700 border-t-violet-400" />
          Loading shop…
        </div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto max-w-[1100px]">
      {/* subtle bg */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-[-60px] h-[300px] w-[300px] -translate-x-1/2 rounded-full bg-indigo-600/15 blur-[80px]" />
        <div className="absolute right-[5%] top-[160px] h-[200px] w-[200px] rounded-full bg-amber-500/10 blur-[70px]" />
      </div>

      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-[0_6px_18px_rgba(99,102,241,0.3)] ring-1 ring-white/10">
          <ShopBagIcon />
        </div>
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white">Shop</h2>
          <p className="text-xs leading-relaxed text-slate-400">
            Pick a plan – pay with Litecoin, get license key instantly as <span className="font-mono text-amber-300">.txt</span>
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-[11px] text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Secure LTC checkout · Auto license
        </span>
        <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-medium text-indigo-300">Most pick PRO $8</span>
      </div>

      {/* compact cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => {
          const isDiscounted = plan.discount > 0;
          const displayPrice = plan.finalPrice ?? plan.price;
          const originalPrice = plan.price;
          return (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-2xl border p-[1px] transition hover:border-slate-600 ${
                plan.popular ? "border-violet-500/40 bg-gradient-to-b from-violet-500/20 to-indigo-500/10 shadow-[0_0_24px_rgba(99,102,241,0.15)]" : "border-slate-800 bg-slate-800/20"
              }`}
            >
              {plan.popular && (
                <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-indigo-500 to-blue-500 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white shadow ring-1 ring-white/20">
                  Most Popular
                </div>
              )}
              <div className="flex flex-1 flex-col rounded-[15px] bg-[#0f1220]/90 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{plan.tier}</span>
                  {isDiscounted && (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300 ring-1 ring-amber-500/20">
                      -{plan.discount}% OFF
                    </span>
                  )}
                </div>

                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="text-[28px] font-bold leading-none text-white">${displayPrice}</span>
                  <span className="text-xs text-slate-500">/mo</span>
                  {isDiscounted && <span className="ml-1 text-xs line-through text-slate-600">${originalPrice}</span>}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  <div className="rounded-lg bg-slate-900/70 px-2.5 py-2 text-center ring-1 ring-slate-800">
                    <div className="text-sm font-bold text-white">{plan.bots}</div>
                    <div className="text-[9px] uppercase tracking-widest text-slate-500">Bots</div>
                  </div>
                  <div className="rounded-lg bg-slate-900/70 px-2.5 py-2 text-center ring-1 ring-slate-800">
                    <div className="text-sm font-bold text-white">{plan.hours}h</div>
                    <div className="text-[9px] uppercase tracking-widest text-slate-500">Hours</div>
                  </div>
                </div>

                <div className="mt-4 space-y-1.5">
                  {plan.features.slice(0, 6).map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px] leading-[1.3] text-slate-300">
                      <span className="grid h-4 w-4 place-items-center rounded-full bg-slate-800 text-[9px] text-slate-400 ring-1 ring-slate-700/50">✓</span>
                      <span className="truncate">{f}</span>
                    </div>
                  ))}
                  {plan.features.length > 6 && (
                    <div className="text-[10px] text-slate-500">+{plan.features.length - 6} more…</div>
                  )}
                </div>

                <button
                  onClick={() => handleBuy(plan)}
                  disabled={!!buying}
                  className={`mt-4 w-full rounded-xl py-2.5 text-xs font-bold transition active:scale-[0.98] disabled:opacity-50 ${
                    plan.popular
                      ? "bg-gradient-to-r from-indigo-500 to-blue-600 text-white shadow-[0_4px_14px_rgba(99,102,241,0.3)] hover:from-indigo-400 hover:to-blue-500"
                      : "border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                  }`}
                >
                  {buying === plan.id ? "Creating invoice…" : "Get started"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Checkout Modal */}
      {invoice && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-[420px] rounded-2xl border border-slate-700 bg-[#151a2c] shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <h3 className="text-sm font-bold text-white">Checkout</h3>
              <button onClick={cancelInvoice} className="grid h-7 w-7 place-items-center rounded-full bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white">
                ✕
              </button>
            </div>

            <div className="p-5">
              {!paidInfo ? (
                <>
                  <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="grid h-8 w-8 place-items-center rounded-lg bg-slate-800 text-slate-300">
                          <LtcIcon />
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-white">AutoSecure · 1 Month</div>
                          <div className="text-[11px] text-slate-500">Everything included</div>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-slate-800 pt-3">
                      <span className="text-xs text-slate-500">Total</span>
                      <div className="text-right">
                        <div className="text-lg font-bold text-white">${invoice.amountUSD}.00</div>
                        <div className="text-[11px] font-mono text-slate-400">≈ {invoice.amountLTC} LTC</div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-[1fr_110px] gap-3">
                    <div className="space-y-3">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Send exactly</div>
                        <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5">
                          <span className="flex-1 truncate font-mono text-xs text-white">{invoice.amountLTC}</span>
                          <button onClick={() => copy(invoice.amountLTC, "amt")} className="rounded bg-slate-800 px-2 py-1 text-[10px] font-bold text-slate-300 hover:bg-slate-700">
                            {copied === "amt" ? "COPIED" : "COPY"}
                          </button>
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">To address</div>
                        <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5">
                          <span className="flex-1 truncate font-mono text-[11px] text-white">{invoice.ltcAddress}</span>
                          <button onClick={() => copy(invoice.ltcAddress, "addr")} className="rounded bg-slate-800 px-2 py-1 text-[10px] font-bold text-slate-300 hover:bg-slate-700">
                            {copied === "addr" ? "COPIED" : "COPY"}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                      {/* QR */}
                      <div className="rounded-lg bg-white p-1.5">
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(`litecoin:${invoice.ltcAddress}?amount=${invoice.amountLTC}`)}`}
                          alt="LTC QR"
                          width={96}
                          height={96}
                          className="h-[96px] w-[96px]"
                        />
                      </div>
                      <div className="text-[10px] text-slate-500">{timeLeft || "30m left"}</div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
                    <div className="flex items-center justify-center gap-2 text-xs text-amber-300">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber-500/30 border-t-amber-400" />
                      Waiting for payment...
                    </div>
                  </div>

                  <div className="mt-3 rounded-lg bg-slate-900/60 px-3 py-2.5 text-[11px] leading-relaxed text-slate-400">
                    <div className="flex gap-2">
                      <span className="mt-0.5">ⓘ</span>
                      <span>
                        Send the exact amount from any LTC wallet. Your license applies automatically once the payment confirms (usually a few minutes).
                        <br />
                        <span className="mt-1 block font-mono text-[10px] text-slate-500">Owner forward: {invoice.ownerLtcAddress.slice(0, 24)}…</span>
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <button onClick={checkPaymentNow} disabled={checking} className="flex-1 rounded-xl border border-slate-700 bg-slate-800 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50">
                      {checking ? "Checking…" : "Check payment"}
                    </button>
                    <button onClick={cancelInvoice} className="flex-1 rounded-xl border border-rose-900/40 bg-rose-500/10 py-2.5 text-xs font-semibold text-rose-400 hover:bg-rose-500/20">
                      Cancel invoice
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/20 text-xl">✓</div>
                  <h4 className="mt-3 text-sm font-bold text-white">Payment confirmed!</h4>
                  <p className="mt-1 text-xs text-slate-400">Your license key is ready – download as .txt and redeem</p>

                  <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                    <div className="text-[10px] uppercase tracking-widest text-slate-500">License key</div>
                    <code className="mt-1 block break-all rounded-lg bg-slate-950 px-3 py-2.5 font-mono text-xs font-bold text-amber-300">{paidInfo.licenseKey}</code>
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => copy(paidInfo.licenseKey, "key")} className="flex-1 rounded-lg bg-slate-800 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700">
                        {copied === "key" ? "Copied!" : "Copy key"}
                      </button>
                      <button onClick={downloadTxt} className="flex-1 rounded-lg bg-amber-500/15 py-2 text-xs font-semibold text-amber-300 ring-1 ring-amber-500/20 hover:bg-amber-500/20">
                        Download .txt
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 rounded-lg bg-slate-900/60 p-3 text-left text-[11px] leading-relaxed text-slate-400">
                    <div>✓ Payment {invoice.amountLTC} LTC detected</div>
                    <div>✓ Funds forwarding to owner: {invoice.ownerLtcAddress.slice(0, 18)}… (auto)</div>
                    <div>✓ {paidInfo.bots} bots, {invoice.hours || 12}h/day for 30 days</div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button onClick={autoRedeem} className="rounded-xl bg-emerald-500 py-3 text-xs font-bold text-emerald-950 hover:bg-emerald-400">
                      Redeem now
                    </button>
                    <button onClick={() => { setInvoice(null); setPaidInfo(null); if (onGoLicense) onGoLicense(); }} className="rounded-xl border border-slate-700 bg-slate-800 py-3 text-xs font-semibold text-slate-200 hover:bg-slate-700">
                      Go to License
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 max-w-[90%] -translate-x-1/2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-xs text-slate-200 shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}

function ShopBagIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 01-8 0" />
    </svg>
  );
}
function LtcIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 8h8M8 12h8M8 16h8M10 4L8 8M14 4l-2 4M10 16l-2 4M14 16l2 4" />
    </svg>
  );
}
