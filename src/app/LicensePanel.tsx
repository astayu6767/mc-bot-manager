"use client";

import { useCallback, useEffect, useState } from "react";

type LicenseInfo = {
  id: string;
  slots: number;
  durationDays: number;
  durationHours: number;
  expiresAt: string;
  active: boolean;
  reason: string;
  licenseKey?: string;
  createdAt: string;
  isExpired: boolean;
  timeLeft: string;
};

type LicenseStatus = {
  totalSlots: number;
  usedSlots: number;
  availableSlots: number;
  activeLicenses: LicenseInfo[];
  expiredLicenses: LicenseInfo[];
  hasActiveLicense: boolean;
  nextExpiry: string | null;
};

export default function LicensePanel() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [redeemMsg, setRedeemMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [redeeming, setRedeeming] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/licenses", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, [refresh]);

  async function redeem() {
    const k = keyInput.trim();
    if (!k) {
      setRedeemMsg({ type: "error", text: "Enter a license key" });
      return;
    }
    if (!k.startsWith("abeam-key-")) {
      setRedeemMsg({ type: "error", text: "Invalid format - key should start with abeam-key-" });
      return;
    }
    setRedeeming(true);
    setRedeemMsg(null);
    try {
      const res = await fetch("/api/licenses/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: k }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRedeemMsg({ type: "error", text: data.error || "Failed to redeem" });
        return;
      }
      setRedeemMsg({ type: "success", text: `Redeemed! Got ${data.license.slots} slots for ${data.license.durationDays}d ${data.license.durationHours}h` });
      setKeyInput("");
      await refresh();
    } catch {
      setRedeemMsg({ type: "error", text: "Network error" });
    } finally {
      setRedeeming(false);
    }
  }

  if (!loaded) {
    return <p className="py-10 text-center text-slate-500">Loading licenses…</p>;
  }

  if (!status) {
    return <p className="py-10 text-center text-slate-500">Failed to load.</p>;
  }

  const hasLicense = status.totalSlots > 0;

  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-xl shadow-lg shadow-orange-900/40">
          🎫
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">License</h2>
          <p className="text-sm text-slate-400">
            Redeem a license key to get bot slots
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        <StatCard label="Total Slots" value={status.totalSlots} accent="text-amber-300" />
        <StatCard label="Used" value={status.usedSlots} accent="text-slate-200" />
        <StatCard label="Available" value={status.availableSlots} accent="text-emerald-300" />
      </div>

      {/* Redeem section - everyone can see */}
      <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-900/60 p-5">
        <h3 className="text-sm font-semibold text-slate-100">Redeem License Key</h3>
        <p className="mt-1 text-xs text-slate-400">Enter your key like <code className="rounded bg-slate-800 px-1 py-0.5 text-amber-300">abeam-key-aqiwok192k</code> to unlock slots</p>
        <div className="mt-4 flex gap-2">
          <input
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && redeem()}
            placeholder="abeam-key-xxxxxxxxxx"
            className="flex-1 rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-sm font-mono text-slate-100 placeholder:text-slate-600 outline-none focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/20"
          />
          <button
            onClick={redeem}
            disabled={redeeming}
            className="rounded-xl bg-gradient-to-b from-amber-400 to-orange-500 px-6 py-3 text-sm font-bold text-amber-950 shadow-lg shadow-orange-900/30 transition hover:from-amber-300 hover:to-orange-400 disabled:opacity-50"
          >
            {redeeming ? "Redeeming…" : "Redeem"}
          </button>
        </div>
        {redeemMsg && (
          <div className={`mt-3 rounded-xl px-3 py-2 text-xs ${redeemMsg.type === "success" ? "bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20" : "bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/20"}`}>
            {redeemMsg.text}
          </div>
        )}
      </div>

      {!hasLicense ? (
        <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-6 text-center">
          <div className="text-3xl">🔒</div>
          <h3 className="mt-3 text-sm font-semibold text-amber-200">No active license</h3>
          <p className="mt-2 text-xs leading-relaxed text-amber-200/70">
            You start with 0 bot slots. Redeem a key above to get slots.
            <br />
            License decides how many slots and for how long (days/hours) they stay.
          </p>
          {status.nextExpiry && (
            <p className="mt-3 text-xs text-slate-400">
              Next expiry: {new Date(status.nextExpiry).toLocaleString()}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-sm font-semibold text-emerald-200">Active License</span>
            </div>
            <p className="mt-2 text-xs text-emerald-200/70">
              You have {status.totalSlots} slots, {status.availableSlots} available.
              {status.nextExpiry && (
                <> Expires {new Date(status.nextExpiry).toLocaleString()} ({status.activeLicenses[0]?.timeLeft})</>
              )}
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-200">Active Licenses</h3>
            <div className="mt-3 space-y-2">
              {status.activeLicenses.map((lic) => (
                <LicenseCard key={lic.id} lic={lic} />
              ))}
            </div>
          </div>

          {status.expiredLicenses.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-400">Expired / Inactive</h3>
              <div className="mt-3 space-y-2">
                {status.expiredLicenses.map((lic) => (
                  <LicenseCard key={lic.id} lic={lic} expired />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LicenseCard({ lic, expired }: { lic: LicenseInfo; expired?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${expired ? "border-slate-800 bg-slate-900/40 opacity-60" : "border-slate-700 bg-slate-900/60"}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${expired ? "bg-slate-500" : "bg-emerald-400"}`} />
          <span className="text-xs font-semibold text-slate-200">{lic.slots} slots</span>
          <span className="text-xs text-slate-500">
            · {lic.durationDays}d {lic.durationHours}h
          </span>
        </div>
        <span className={`text-xs ${expired ? "text-slate-500" : "text-amber-300"}`}>{lic.timeLeft}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-2 text-[11px] text-slate-500">
        <span>Expires: {new Date(lic.expiresAt).toLocaleString()}</span>
        {lic.reason && <span>· {lic.reason}</span>}
        {lic.licenseKey && <span className="font-mono text-amber-300/60">· {lic.licenseKey.slice(0,20)}...</span>}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <div className={`text-2xl font-semibold ${accent}`}>{value}</div>
      <div className="mt-0.5 text-xs uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}
