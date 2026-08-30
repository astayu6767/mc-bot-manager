"use client";

import { useCallback, useEffect, useState } from "react";

type AdminUser = {
  id: string;
  username: string;
  avatar: string | null;
  role: string;
  botSlots: number;
  botCount: number;
  botsOnline: number;
  isGuest: boolean;
  discordId: string | null;
  createdAt: string;
};

type AdminBot = {
  id: string;
  name: string;
  username: string | null;
  host: string;
  port: number;
  status: string;
};

type LicenseKeyInfo = {
  id: string;
  key: string;
  slots: number;
  durationDays: number;
  durationHours: number;
  reason: string;
  active: boolean;
  redeemed: boolean;
  redeemedBy?: string | null;
  redeemedByUsername?: string | null;
  redeemedAt?: string | null;
  createdAt: string;
};

type LicenseInfo = {
  id: string;
  userId: string;
  username: string;
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

export default function AdminPanel({ meId }: { meId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [bots, setBots] = useState<AdminBot[]>([]);
  const [busy, setBusy] = useState(false);

  // License keys
  const [licenseKeys, setLicenseKeys] = useState<LicenseKeyInfo[]>([]);
  const [licenses, setLicenses] = useState<LicenseInfo[]>([]);
  const [slots, setSlots] = useState(1);
  const [days, setDays] = useState(7);
  const [hours, setHours] = useState(0);
  const [reason, setReason] = useState("");
  const [lastGeneratedKey, setLastGeneratedKey] = useState<string | null>(null);

  // Create account
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("user");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setUsers(data.users ?? []);
    } finally {
      setLoaded(true);
    }
  }, []);

  const refreshLicenses = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/licenses", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setLicenseKeys(data.licenseKeys ?? []);
        setLicenses(data.licenses ?? []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    refreshLicenses();
    const t = setInterval(() => {
      refresh();
      refreshLicenses();
    }, 5000);
    return () => clearInterval(t);
  }, [refresh, refreshLicenses]);

  async function loadBots(userId: string) {
    if (expanded === userId) {
      setExpanded(null);
      setBots([]);
      return;
    }
    setExpanded(userId);
    setBots([]);
    const res = await fetch(`/api/admin/users/${userId}/bots`, {
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      setBots(data.bots ?? []);
    }
  }

  async function setSlotsForUser(userId: string, botSlots: number) {
    if (botSlots < 0) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botSlots }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggleRole(u: AdminUser) {
    setBusy(true);
    try {
      await fetch(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: u.role === "admin" ? "user" : "admin" }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removeBot(botId: string, userId: string) {
    if (!confirm("Remove this bot?")) return;
    setBusy(true);
    try {
      await fetch(`/api/bots/${botId}`, { method: "DELETE" });
      const res = await fetch(`/api/admin/users/${userId}/bots`, {
        cache: "no-store",
      });
      if (res.ok) setBots((await res.json()).bots ?? []);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser(u: AdminUser) {
    if (
      !confirm(
        `Delete user "${u.username}" and ALL their bots? This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    try {
      await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function createAccount() {
    if (!newUsername.trim() || !newPassword.trim()) {
      alert("Username and password required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/users/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword,
          role: newRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to create account");
        return;
      }
      setNewUsername("");
      setNewPassword("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function createLicenseKey() {
    if (slots <= 0) {
      alert("Slots must be > 0");
      return;
    }
    if (days === 0 && hours === 0) {
      alert("Duration must be at least 1 hour");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/licenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slots,
          durationDays: days,
          durationHours: hours,
          reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to create license");
        return;
      }
      setLastGeneratedKey(data.key || data.licenseKey?.key);
      setReason("");
      await refreshLicenses();
    } finally {
      setBusy(false);
    }
  }

  async function deleteLicenseKey(id: string, type: "key" | "license" = "key") {
    if (!confirm(`Delete this ${type}?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/licenses/${id}?type=${type}`, { method: "DELETE" });
      await refreshLicenses();
    } finally {
      setBusy(false);
    }
  }

  async function revokeLicenseKey(id: string, type: "key" | "license" = "key") {
    if (!confirm(`Revoke this ${type}?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/licenses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", type }),
      });
      await refreshLicenses();
    } finally {
      setBusy(false);
    }
  }

  const totalUsers = users.length;
  const totalBots = users.reduce((a, u) => a + u.botCount, 0);
  const totalOnline = users.reduce((a, u) => a + u.botsOnline, 0);

  const activeKeys = licenseKeys.filter((k) => k.active && !k.redeemed);
  const redeemedKeys = licenseKeys.filter((k) => k.redeemed);

  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-700 text-xl shadow-lg shadow-purple-900/40">
          🛡️
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Admin Panel</h2>
          <p className="text-sm text-slate-400">
            Manage users, bot slots, licenses and running bots.
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <StatCard label="Users" value={totalUsers} accent="text-sky-300" />
        <StatCard label="Total bots" value={totalBots} accent="text-slate-200" />
        <StatCard
          label="Bots online"
          value={totalOnline}
          accent="text-emerald-300"
        />
      </div>

      {/* Create Account */}
      <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="text-sm font-semibold text-slate-200">Create Account (username/password)</h3>
        <p className="mt-1 text-xs text-slate-500">For now - create local accounts. Will be removed later. Admin can create accounts for people.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <input
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder="Username"
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-fuchsia-500/60"
          />
          <input
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Password"
            type="password"
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-fuchsia-500/60"
          />
          <div className="flex gap-2">
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none"
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
            <button
              disabled={busy}
              onClick={createAccount}
              className="rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {!loaded ? (
          <p className="py-10 text-center text-slate-500">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="py-10 text-center text-slate-500">No users yet.</p>
        ) : (
          users.map((u) => (
            <div
              key={u.id}
              className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {u.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={u.avatar}
                      alt=""
                      className="h-10 w-10 rounded-full"
                    />
                  ) : (
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-slate-700 text-sm font-bold">
                      {u.username.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{u.username}</span>
                      {u.role === "admin" && (
                        <span className="rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-xs font-medium text-fuchsia-300 ring-1 ring-fuchsia-500/30">
                          admin
                        </span>
                      )}
                      {u.isGuest && (
                        <span className="rounded-full bg-slate-700/40 px-2 py-0.5 text-xs text-slate-400 ring-1 ring-slate-600/40">
                          guest
                        </span>
                      )}
                      {u.id === meId && (
                        <span className="text-xs text-slate-500">(you)</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      <span className="text-emerald-300">
                        {u.botsOnline} online
                      </span>{" "}
                      · {u.botCount}/{u.botSlots} bots
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 p-1">
                    <button
                      disabled={busy || u.botSlots <= 0}
                      onClick={() => setSlotsForUser(u.id, u.botSlots - 1)}
                      className="grid h-6 w-6 place-items-center rounded text-slate-300 hover:bg-slate-700 disabled:opacity-40"
                    >
                      −
                    </button>
                    <span className="min-w-[3.5rem] text-center text-xs text-slate-300">
                      {u.botSlots} slots
                    </span>
                    <button
                      disabled={busy}
                      onClick={() => setSlotsForUser(u.id, u.botSlots + 1)}
                      className="grid h-6 w-6 place-items-center rounded text-slate-300 hover:bg-slate-700 disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>

                  <button
                    onClick={() => loadBots(u.id)}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                  >
                    {expanded === u.id ? "Hide bots" : "View bots"}
                  </button>

                  {u.id !== meId && (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => toggleRole(u)}
                        className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                      >
                        {u.role === "admin" ? "Demote" : "Make admin"}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => deleteUser(u)}
                        className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-400 hover:border-rose-500/40 hover:text-rose-300 disabled:opacity-40"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>

              {expanded === u.id && (
                <div className="mt-3 border-t border-slate-800 pt-3">
                  {bots.length === 0 ? (
                    <p className="text-xs text-slate-500">No bots.</p>
                  ) : (
                    <ul className="space-y-2">
                      {bots.map((b) => (
                        <li
                          key={b.id}
                          className="flex items-center justify-between gap-2 rounded-lg bg-slate-950/40 px-3 py-2 text-xs"
                        >
                          <span className="flex items-center gap-2 truncate">
                            <span
                              className={`h-2 w-2 rounded-full ${
                                b.status === "online"
                                  ? "bg-emerald-400"
                                  : b.status === "connecting"
                                    ? "bg-amber-400"
                                    : b.status === "error"
                                      ? "bg-rose-500"
                                      : "bg-slate-500"
                              }`}
                            />
                            <span className="font-medium text-slate-200">
                              {b.name}
                            </span>
                            <span className="text-slate-500">
                              {b.host}:{b.port}
                            </span>
                            {b.username && (
                              <span className="text-slate-500">
                                · {b.username}
                              </span>
                            )}
                          </span>
                          <button
                            disabled={busy}
                            onClick={() => removeBot(b.id, u.id)}
                            className="rounded border border-slate-700 px-2 py-1 text-slate-400 hover:border-rose-500/40 hover:text-rose-300 disabled:opacity-40"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* License Management - right below users */}
      <div className="mt-8">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-lg">
            🎫
          </div>
          <div>
            <h3 className="text-base font-semibold tracking-tight">License Keys</h3>
            <p className="text-xs text-slate-400">Generate redeemable keys like abeam-key-xxxx - user redeems in License tab</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <StatCard label="Active Keys" value={activeKeys.length} accent="text-emerald-300" />
          <StatCard label="Redeemed" value={redeemedKeys.length} accent="text-amber-300" />
          <StatCard label="Total Slots Given" value={licenses.filter(l=>l.active).reduce((a,l)=>a+l.slots,0)} accent="text-sky-300" />
        </div>

        <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h4 className="text-sm font-semibold text-slate-200">Generate New License Key</h4>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-slate-400">Slots</label>
              <input
                type="number"
                min={1}
                value={slots}
                onChange={(e) => setSlots(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-amber-500/60"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400">Reason / Note</label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Weekly plan, VIP"
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-amber-500/60"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400">Days</label>
              <input
                type="number"
                min={0}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-amber-500/60"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400">Hours</label>
              <input
                type="number"
                min={0}
                max={23}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-amber-500/60"
              />
              <p className="mt-1 text-[11px] text-slate-500">{days}d {hours}h = {days*24+hours}h</p>
            </div>
          </div>

          {lastGeneratedKey && (
            <div className="mt-4 rounded-xl bg-emerald-500/10 p-3 ring-1 ring-emerald-500/20">
              <p className="text-xs font-medium text-emerald-300">Last generated key:</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 rounded-lg bg-slate-950 px-3 py-2 text-sm font-mono text-amber-300">{lastGeneratedKey}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(lastGeneratedKey)}
                  className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"
                >
                  Copy
                </button>
              </div>
            </div>
          )}

          <button
            disabled={busy}
            onClick={createLicenseKey}
            className="mt-4 w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-900/30 transition hover:from-amber-400 hover:to-orange-500 disabled:opacity-50"
          >
            {busy ? "Generating..." : `Generate Key - ${slots} slots for ${days}d ${hours}h`}
          </button>
        </div>

        <div className="mt-6">
          <h4 className="text-sm font-semibold text-slate-200">Active Redeemable Keys</h4>
          {activeKeys.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">No active keys</p>
          ) : (
            <div className="mt-3 space-y-2">
              {activeKeys.map((k) => (
                <div key={k.id} className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-400" />
                      <code className="truncate text-xs font-mono font-semibold text-amber-300">{k.key}</code>
                      <span className="text-xs text-slate-400">· {k.slots} slots · {k.durationDays}d {k.durationHours}h</span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      Created: {new Date(k.createdAt).toLocaleString()} {k.reason && <>· {k.reason}</>}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => navigator.clipboard.writeText(k.key)}
                      className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                    >
                      Copy
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => revokeLicenseKey(k.id, "key")}
                      className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 disabled:opacity-40"
                    >
                      Revoke
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => deleteLicenseKey(k.id, "key")}
                      className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-rose-400 hover:border-rose-500/40 disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {redeemedKeys.length > 0 && (
            <div className="mt-6">
              <h4 className="text-sm font-semibold text-slate-500">Redeemed Keys</h4>
              <div className="mt-3 space-y-2">
                {redeemedKeys.map((k) => (
                  <div key={k.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/40 p-3 opacity-70">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-slate-500" />
                        <code className="text-xs font-mono text-slate-400">{k.key}</code>
                        <span className="text-xs text-slate-500">· {k.slots} slots · redeemed by {k.redeemedByUsername || "unknown"}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-600">
                        Redeemed: {k.redeemedAt ? new Date(k.redeemedAt).toLocaleString() : "unknown"}
                      </div>
                    </div>
                    <button
                      disabled={busy}
                      onClick={() => deleteLicenseKey(k.id, "key")}
                      className="rounded-lg border border-slate-800 px-2 py-1 text-xs text-slate-500 hover:text-rose-400 disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {licenses.length > 0 && (
            <div className="mt-6">
              <h4 className="text-sm font-semibold text-slate-400">Redeemed Licenses (active grants)</h4>
              <div className="mt-3 space-y-2">
                {licenses.filter(l=>l.active && !l.isExpired).slice(0,10).map((lic) => (
                  <div key={lic.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        <span className="text-xs font-semibold text-slate-300">{lic.username}</span>
                        <span className="text-xs text-slate-500">· {lic.slots} slots · {lic.timeLeft}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-600">
                        Key: {lic.licenseKey?.slice(0,20)}... · Expires: {new Date(lic.expiresAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        disabled={busy}
                        onClick={() => revokeLicenseKey(lic.id, "license")}
                        className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 disabled:opacity-40"
                      >
                        Revoke
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => deleteLicenseKey(lic.id, "license")}
                        className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-rose-400 hover:border-rose-500/40 disabled:opacity-40"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <div className={`text-2xl font-semibold ${accent}`}>{value}</div>
      <div className="mt-0.5 text-xs uppercase tracking-wide text-slate-500">
        {label}
      </div>
    </div>
  );
}
