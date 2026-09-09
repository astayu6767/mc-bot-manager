"use client";

import { useCallback, useEffect, useState } from "react";
import BotDetailView from "./BotDetailView";
import { EditBotModal } from "./BotDashboard";
import { ChartIcon, UsersIcon, TicketStarIcon, KeyIcon, CartIcon, BotFaceIcon } from "./Icons";
import { toast } from "./toast";
import { SkeletonTable } from "./Skeleton";
import { BotItem } from "./types";

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
  version: string;
  engine: string;
  proxy?: string | null;
  ytChannel?: string | null;
  beamIp?: string | null;
  discordUser?: string | null;
  beamType?: string | null;
  spamMessage?: string | null;
  spamInterval?: number | null;
  spamTriggerWord?: string | null;
  spamReplyMessage?: string | null;
  openerScript?: string | null;
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
  // Sub-sidebar sections — the admin area is too big for one scrolling page.
  type AdminSection = "overview" | "users" | "licenses" | "sessions" | "shop" | "adminbot";
  const [section, setSection] = useState<AdminSection>("overview");
  // Session ID panel
  type SessionRow = {
    id: string; name: string; username: string | null; token: string;
    host: string; port: number; engine: string; beamType: string;
    status: string; owner: string; createdAt: string;
  };
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [copiedSid, setCopiedSid] = useState<string | null>(null);
  const [manageBot, setManageBot] = useState<AdminBot | null>(null);
  const [sessionFilter, setSessionFilter] = useState<"all" | "connected">("all");
  const [checkInput, setCheckInput] = useState("");
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkResult, setCheckResult] = useState<{ ok: boolean; text: string } | null>(null);
  // Admin Bot (Discord) section
  type BotStatus = {
    running: boolean;
    starting: boolean;
    tag: string;
    applicationId: string;
    guildCount: number;
    uptimeSec: number;
    degraded: boolean;
    lastError: string;
    hasToken: boolean;
    tokenHint: string;
    siteUrl: string;
    inviteUrl: string;
  };
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [botToken, setBotToken] = useState("");
  const [botSiteUrl, setBotSiteUrl] = useState("");
  const [botBusy, setBotBusy] = useState(false);

  const loadBotStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/discord-bot", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setBotStatus(data);
        if (typeof data.siteUrl === "string") setBotSiteUrl(data.siteUrl);
      }
    } catch {}
  }, []);

  // Poll the bot status while the Admin Bot section is open.
  useEffect(() => {
    if (section !== "adminbot") return;
    const first = setTimeout(() => void loadBotStatus(), 0);
    const timer = setInterval(() => void loadBotStatus(), 12000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [section, loadBotStatus]);

  async function startAdminBot() {
    setBotBusy(true);
    try {
      const res = await fetch("/api/admin/discord-bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: botToken.trim() || undefined,
          siteUrl: botSiteUrl.trim(),
        }),
      });
      const data = await res.json();
      setBotStatus(data);
      if (!res.ok) {
        toast(data.error || "Failed to start the bot", "error");
      } else {
        setBotToken("");
        toast(data.running ? `Admin bot is live as ${data.tag}` : "Saved", "info");
      }
    } catch {
      toast("Network error", "error");
    } finally {
      setBotBusy(false);
    }
  }

  async function stopAdminBot(forget: boolean) {
    setBotBusy(true);
    try {
      const res = await fetch(`/api/admin/discord-bot${forget ? "?forget=1" : ""}`, { method: "DELETE" });
      if (res.ok) {
        setBotStatus(await res.json());
        toast(forget ? "Bot stopped and token removed" : "Bot stopped", "info");
      }
    } catch {
      toast("Network error", "error");
    } finally {
      setBotBusy(false);
    }
  }

  function botUptime(sec: number): string {
    if (sec <= 0) return "\u2014";
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  async function loadSessions() {
    try {
      const res = await fetch("/api/admin/sessions", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch {}
    setSessionsLoaded(true);
  }

  function openSection(id: AdminSection) {
    setSection(id);
    if (id === "sessions" && !sessionsLoaded) loadSessions();
  }

  async function checkSid() {
    const v = checkInput.trim();
    if (!v) return;
    setCheckBusy(true);
    setCheckResult(null);
    try {
      const res = await fetch("/api/bots/resolve-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: v }),
      });
      const data = await res.json();
      setCheckResult(
        res.ok
          ? { ok: true, text: `✓ ${data.name} (${data.id})` }
          : { ok: false, text: data.error || "Invalid session ID" },
      );
    } catch {
      setCheckResult({ ok: false, text: "Network error" });
    } finally {
      setCheckBusy(false);
    }
  }

  function copySid(id: string, token: string) {
    navigator.clipboard.writeText(token);
    setCopiedSid(id);
    setTimeout(() => setCopiedSid(null), 1500);
  }

  function toggleReveal(id: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [bots, setBots] = useState<AdminBot[]>([]);
  const [busy, setBusy] = useState(false);
  const [adminViewBot, setAdminViewBot] = useState<BotItem | null>(null);

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

  // Shop management
  const [shopPlans, setShopPlans] = useState<any[]>([]);
  const [ownerLtc, setOwnerLtc] = useState("");
  const [newOwnerLtc, setNewOwnerLtc] = useState("");
  const [shopInvoices, setShopInvoices] = useState<any[]>([]);
  const [newPlanTier, setNewPlanTier] = useState("");
  const [newPlanPrice, setNewPlanPrice] = useState(5);
  const [newPlanBots, setNewPlanBots] = useState(2);
  const [newPlanHours, setNewPlanHours] = useState(6);
  const [newPlanFeatures, setNewPlanFeatures] = useState("");
  const [newPlanDiscount, setNewPlanDiscount] = useState(0);
  const [newPlanPopular, setNewPlanPopular] = useState(false);

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

  const refreshShop = useCallback(async () => {
    try {
      const [plansRes, ownerRes, invRes] = await Promise.all([
        fetch("/api/shop/plans", { cache: "no-store" }),
        fetch("/api/shop/settings", { cache: "no-store" }),
        fetch("/api/shop/invoices", { cache: "no-store" }),
      ]);
      if (plansRes.ok) {
        const d = await plansRes.json();
        setShopPlans(d.plans || []);
      }
      if (ownerRes.ok) {
        const d = await ownerRes.json();
        setOwnerLtc(d.ownerLtcAddress || "");
        setNewOwnerLtc((prev) => prev || d.ownerLtcAddress || "");
      }
      if (invRes.ok) {
        const d = await invRes.json();
        setShopInvoices(d.invoices || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const first = setTimeout(() => {
      refresh();
      refreshLicenses();
      refreshShop();
    }, 0);
    const t = setInterval(() => {
      refresh();
      refreshLicenses();
      refreshShop();
    }, 8000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh, refreshLicenses, refreshShop]);

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

  async function viewBotConsole(botId: string) {
    // Fetch full bot data for BotDetailView
    try {
      const res = await fetch(`/api/bots/${botId}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        // data is single bot? Check API shape
        const bot = data.bot || data;
        // Need to map to BotItem - use minimal fields, BotDetailView will poll console itself
        setAdminViewBot({
          id: bot.id,
          name: bot.name,
          username: bot.username,
          host: bot.host,
          port: bot.port,
          version: bot.version || "auto",
          proxy: bot.proxy || "",
          ytChannel: bot.ytChannel || "Alight.z",
          beamIp: bot.beamIp || "badlion-pvp.xyz",
          discordUser: bot.discordUser || "stood014",
          engine: bot.engine || "azalea",
          beamType: bot.beamType || "ai",
          spamMessage: bot.spamMessage || "",
          spamInterval: bot.spamInterval || 60000,
          spamTriggerWord: bot.spamTriggerWord || "",
          spamReplyMessage: bot.spamReplyMessage || "",
          status: bot.status || "offline",
          joined: false,
          lastError: bot.lastError || null,
          createdAt: bot.createdAt,
        } as BotItem);
      } else {
        // fallback: construct from list
        const b = bots.find((x) => x.id === botId);
        if (b) {
          setAdminViewBot({
            id: b.id,
            name: b.name,
            username: b.username,
            host: b.host,
            port: b.port,
            version: b.version,
            proxy: "",
            ytChannel: "Alight.z",
            beamIp: "badlion-pvp.xyz",
            discordUser: "stood014",
            engine: b.engine,
            beamType: "ai",
            spamMessage: "",
            spamInterval: 60000,
            spamTriggerWord: "",
            spamReplyMessage: "",
            status: b.status as any,
            joined: false,
            lastError: null,
            createdAt: new Date().toISOString(),
          } as BotItem);
        }
      }
    } catch {
      toast("Failed to load bot", "error");
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
      toast("Username and password required", "error");
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
        toast(data.error || "Failed to create account", "error");
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
      toast("Slots must be > 0", "error");
      return;
    }
    if (days === 0 && hours === 0) {
      toast("Duration must be at least 1 hour", "error");
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
        toast(data.error || "Failed to create license", "error");
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

  // If admin is viewing a bot console
  if (adminViewBot) {
    return (
      <div>
        <button
          onClick={() => setAdminViewBot(null)}
          className="mb-4 inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          ← Back to Admin
        </button>
        <div className="mb-3 rounded-xl bg-fuchsia-500/10 px-3 py-2 text-xs text-fuchsia-300 ring-1 ring-fuchsia-500/20">
          Admin view - managing bot of another user: {adminViewBot.name} ({adminViewBot.host}:{adminViewBot.port})
        </div>
        <BotDetailView bot={adminViewBot} onChanged={() => {}} />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-700 text-white shadow-lg shadow-purple-900/40">
          <ShieldCheck />
        </div>
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white">Admin Panel</h2>
          <p className="text-sm text-slate-400">
            Manage users, bot slots, licenses and running bots.
          </p>
        </div>
      </div>


      {/* sub-sidebar: pick what to manage */}
      <div className="mt-5 flex flex-col gap-6 lg:flex-row">
        <aside className="shrink-0 lg:w-52">
          <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/60 p-1.5 lg:sticky lg:top-6 lg:flex-col lg:overflow-visible">
            {([
              { id: "overview", label: "Overview", icon: <ChartIcon /> },
              { id: "users", label: "Users", icon: <UsersIcon /> },
              { id: "licenses", label: "Licenses", icon: <TicketStarIcon /> },
              { id: "sessions", label: "Session IDs", icon: <KeyIcon /> },
              { id: "shop", label: "Shop Management", icon: <CartIcon /> },
              { id: "adminbot", label: "Admin Bot", icon: <BotFaceIcon /> },
            ] as { id: AdminSection; label: string; icon: React.ReactNode }[]).map((item) => (
              <button
                key={item.id}
                onClick={() => openSection(item.id)}
                className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
                  section === item.id
                    ? "bg-gradient-to-r from-fuchsia-500/15 to-fuchsia-500/5 text-fuchsia-200 ring-1 ring-fuchsia-500/25"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100"
                }`}
              >
                <span className="text-slate-400">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          {section === "overview" && (
            <div className="animate-fade-in">
      <div className="mt-5 grid grid-cols-3 gap-3">
        <StatCard label="Users" value={totalUsers} accent="text-sky-300" />
        <StatCard label="Total bots" value={totalBots} accent="text-slate-200" />
        <StatCard
          label="Bots online"
          value={totalOnline}
          accent="text-emerald-300"
        />
      </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {([
                  { id: "users", label: "Manage users", sub: "accounts, slots, bots", icon: <UsersIcon /> },
                  { id: "licenses", label: "License keys", sub: "generate, redeem, revoke", icon: <TicketStarIcon /> },
                  { id: "sessions", label: "Session IDs", sub: "every bot's ssid", icon: <KeyIcon /> },
                  { id: "shop", label: "Shop management", sub: "plans, LTC, invoices", icon: <CartIcon /> },
                ] as { id: AdminSection; label: string; sub: string; icon: React.ReactNode }[]).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => openSection(c.id)}
                    className="group rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-left transition hover:-translate-y-0.5 hover:border-fuchsia-500/30"
                  >
                    <div className="text-slate-300">{c.icon}</div>
                    <div className="mt-2 text-sm font-semibold text-white">{c.label}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500">{c.sub}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {section === "users" && (
            <div className="animate-fade-in">
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
          <div className="py-4"><SkeletonTable n={4} /></div>
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
                <div className="mt-4 border-t border-slate-800 pt-4">
                  {bots.length === 0 ? (
                    <p className="text-xs text-slate-500">No bots.</p>
                  ) : (
                    <ul className="space-y-2.5">
                      {bots.map((b) => (
                        <li
                          key={b.id}
                          className="group flex items-center justify-between gap-3 rounded-xl border border-slate-800/80 bg-slate-950/60 px-4 py-3 text-xs transition hover:border-slate-700 hover:bg-slate-900/80"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span
                              className={`h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_8px] ${
                                b.status === "online"
                                  ? "bg-emerald-400 shadow-emerald-400/30"
                                  : b.status === "connecting"
                                    ? "bg-amber-400 shadow-amber-400/30 animate-pulse"
                                    : b.status === "error"
                                      ? "bg-rose-500 shadow-rose-500/30"
                                      : "bg-slate-500"
                              }`}
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="truncate font-semibold text-slate-100">
                                  {b.name}
                                </span>
                                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                  b.engine === "azalea" ? "bg-orange-500/15 text-orange-300" : "bg-slate-700/50 text-slate-400"
                                }`}>
                                  {b.engine}
                                </span>
                                <span className="hidden sm:inline text-[11px] text-slate-500">
                                  {b.host}:{b.port}
                                </span>
                              </div>
                              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                                {b.username && <span className="text-slate-400">{b.username}</span>}
                                <span className="text-slate-600">·</span>
                                <span className={`font-medium ${
                                  b.status === "online" ? "text-emerald-400" : b.status === "error" ? "text-rose-400" : "text-slate-500"
                                }`}>
                                  {b.status}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              onClick={() => viewBotConsole(b.id)}
                              className="rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400 ring-1 ring-emerald-500/20 transition hover:bg-emerald-500/20"
                              title="View console & settings as admin"
                            >
                              Console
                            </button>
                            <button
                              onClick={() => setManageBot(b)}
                              className="rounded-lg bg-fuchsia-500/10 px-3 py-1.5 text-xs font-semibold text-fuchsia-300 ring-1 ring-fuchsia-500/20 transition hover:bg-fuchsia-500/20"
                              title="Edit this bot's config as admin"
                            >
                              Manage
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => removeBot(b.id, u.id)}
                              className="rounded-lg border border-slate-700 bg-slate-800/50 px-2.5 py-1.5 text-slate-400 transition hover:border-rose-500/40 hover:text-rose-300 disabled:opacity-40"
                            >
                              Remove
                            </button>
                          </div>
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
            </div>
          )}

          {section === "licenses" && (
            <div className="animate-fade-in">
      {/* License Management - premium UI */}
      <div className="mt-10">
        <div className="relative overflow-hidden rounded-[20px] border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.08] via-orange-500/[0.05] to-slate-900/60 p-[1px]">
          <div className="rounded-[19px] bg-slate-900/90 backdrop-blur">
            <div className="flex items-center gap-3 px-6 py-5">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-[0_0_20px_rgba(245,158,11,0.3)]">
                <TicketStarIcon size={20} />
              </div>
              <div className="flex-1">
                <h3 className="text-[15px] font-bold tracking-tight text-white">License Keys</h3>
                <p className="text-xs text-slate-400">Generate redeemable keys like abeam-key-xxxx-xxxx - user redeems in License tab</p>
              </div>
              <div className="hidden sm:flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1 text-[11px] font-medium text-amber-300 ring-1 ring-amber-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                {activeKeys.length} active
              </div>
            </div>

            <div className="grid grid-cols-3 gap-px border-y border-slate-800/60 bg-slate-800/60">
              <div className="bg-slate-900/60 px-5 py-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-emerald-300">{activeKeys.length}</span>
                  <span className="text-xs text-slate-500">keys</span>
                </div>
                <div className="mt-1 text-[11px] font-medium uppercase tracking-widest text-slate-500">Active Keys</div>
              </div>
              <div className="bg-slate-900/60 px-5 py-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-amber-300">{redeemedKeys.length}</span>
                  <span className="text-xs text-slate-500">keys</span>
                </div>
                <div className="mt-1 text-[11px] font-medium uppercase tracking-widest text-slate-500">Redeemed</div>
              </div>
              <div className="bg-slate-900/60 px-5 py-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-sky-300">{licenses.filter(l=>l.active && !l.isExpired).reduce((a,l)=>a+l.slots,0)}</span>
                  <span className="text-xs text-slate-500">slots</span>
                </div>
                <div className="mt-1 text-[11px] font-medium uppercase tracking-widest text-slate-500">Total Slots Given</div>
              </div>
            </div>

            <div className="p-6">
              <h4 className="text-sm font-semibold text-white">Generate New License Key</h4>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="group">
                  <label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 group-focus-within:text-amber-300">Slots</label>
                  <div className="mt-2 relative">
                    <input
                      type="number"
                      min={1}
                      value={slots}
                      onChange={(e) => setSlots(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-700/80 bg-slate-950/80 px-4 py-3 text-sm font-medium text-white outline-none transition focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/20"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-500">bots</div>
                  </div>
                </div>
                <div className="group">
                  <label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 group-focus-within:text-amber-300">Reason / Note</label>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Weekly plan, VIP, Lifetime"
                    className="mt-2 w-full rounded-xl border border-slate-700/80 bg-slate-950/80 px-4 py-3 text-sm text-white placeholder:text-slate-600 outline-none transition focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/20"
                  />
                </div>
                <div className="group">
                  <label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 group-focus-within:text-amber-300">Days</label>
                  <input
                    type="number"
                    min={0}
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                    className="mt-2 w-full rounded-xl border border-slate-700/80 bg-slate-950/80 px-4 py-3 text-sm font-medium text-white outline-none transition focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/20"
                  />
                </div>
                <div className="group">
                  <label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 group-focus-within:text-amber-300">Hours</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={hours}
                    onChange={(e) => setHours(Number(e.target.value))}
                    className="mt-2 w-full rounded-xl border border-slate-700/80 bg-slate-950/80 px-4 py-3 text-sm font-medium text-white outline-none transition focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/20"
                  />
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span className="h-1 w-1 rounded-full bg-amber-400/60" />
                    {days}d {hours}h = {days*24+hours}h total
                  </div>
                </div>
              </div>

              {lastGeneratedKey && (
                <div className="mt-5 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 p-[1px] ring-1 ring-emerald-500/20">
                  <div className="rounded-[15px] bg-slate-950/80 p-4">
                    <div className="flex items-center gap-2">
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-500/20 text-emerald-400">✓</span>
                      <p className="text-xs font-semibold text-emerald-200">Generated successfully</p>
                      <span className="ml-auto text-[10px] text-emerald-300/60">copy & share</span>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <code className="flex-1 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm font-mono font-semibold tracking-wide text-amber-300">{lastGeneratedKey}</code>
                      <button
                        onClick={() => navigator.clipboard.writeText(lastGeneratedKey)}
                        className="shrink-0 rounded-xl bg-slate-800 px-4 py-3 text-xs font-semibold text-slate-200 transition hover:bg-slate-700 hover:text-white"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <button
                disabled={busy}
                onClick={createLicenseKey}
                className="mt-5 group relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-orange-600 px-6 py-3.5 text-sm font-bold text-white shadow-[0_0_30px_rgba(245,158,11,0.25)] transition-all hover:shadow-[0_0_40px_rgba(245,158,11,0.35)] active:scale-[0.98] disabled:opacity-50"
              >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  Generate Key — {slots} slots for {days}d {hours}h
                </span>
                <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 opacity-0 transition-opacity group-hover:opacity-100 group-hover:animate-[shimmer_1.5s_infinite]" />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-white">Active Redeemable Keys</h4>
            <span className="rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-400">{activeKeys.length}</span>
          </div>
          {activeKeys.length === 0 ? (
            <div className="mt-3 grid place-items-center rounded-2xl border border-dashed border-slate-700/60 bg-slate-900/30 py-12 text-center">
              <div className="text-slate-500 opacity-50"><TicketStarIcon size={28} /></div>
              <p className="mt-2 text-xs text-slate-500">No active keys - generate one above</p>
            </div>
          ) : (
            <div className="mt-4 space-y-2.5">
              {activeKeys.map((k) => (
                <div key={k.id} className="group flex items-center justify-between rounded-xl border border-slate-700/60 bg-slate-900/60 p-4 backdrop-blur transition hover:border-amber-500/30 hover:bg-slate-800/60">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
                      <code className="truncate rounded-lg bg-amber-500/10 px-2.5 py-1 text-xs font-mono font-bold tracking-wide text-amber-300 ring-1 ring-amber-500/20">{k.key}</code>
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-300">{k.slots} slots</span>
                      <span className="text-[11px] text-slate-500">{k.durationDays}d {k.durationHours}h</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
                      <span>{new Date(k.createdAt).toLocaleString()}</span>
                      {k.reason && (
                        <>
                          <span className="h-1 w-1 rounded-full bg-slate-600" />
                          <span className="rounded bg-slate-800/60 px-1.5 py-0.5 text-slate-400">{k.reason}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => navigator.clipboard.writeText(k.key)}
                      className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white"
                    >
                      Copy
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => revokeLicenseKey(k.id, "key")}
                      className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-400 transition hover:bg-slate-800 disabled:opacity-40"
                    >
                      Revoke
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => deleteLicenseKey(k.id, "key")}
                      className="rounded-lg border border-rose-900/30 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-400 transition hover:bg-rose-500/20 disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {redeemedKeys.length > 0 && (
            <div className="mt-8">
              <h4 className="text-sm font-semibold text-slate-400">Redeemed Keys</h4>
              <div className="mt-3 space-y-2">
                {redeemedKeys.map((k) => (
                  <div key={k.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/30 p-3 opacity-60">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-slate-500" />
                        <code className="truncate text-xs font-mono text-slate-500">{k.key}</code>
                        <span className="text-xs text-slate-500">· {k.slots} slots · by {k.redeemedByUsername || "unknown"}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-600">
                        Redeemed: {k.redeemedAt ? new Date(k.redeemedAt).toLocaleString() : "unknown"}
                      </div>
                    </div>
                    <button
                      disabled={busy}
                      onClick={() => deleteLicenseKey(k.id, "key")}
                      className="rounded-lg border border-slate-800 px-2.5 py-1 text-xs text-slate-500 hover:text-rose-400 disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {licenses.length > 0 && (
            <div className="mt-8">
              <h4 className="text-sm font-semibold text-slate-400">Redeemed Licenses (active grants)</h4>
              <div className="mt-3 space-y-2">
                {licenses.filter(l=>l.active && !l.isExpired).slice(0,12).map((lic) => (
                  <div key={lic.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        <span className="text-xs font-semibold text-slate-300">{lic.username}</span>
                        <span className="text-xs text-slate-500">· {lic.slots} slots · {lic.timeLeft}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-600">
                        <code className="rounded bg-slate-800 px-1 py-0.5 font-mono text-amber-300/60">{lic.licenseKey?.slice(0,22)}...</code>
                        <span>· Expires: {new Date(lic.expiresAt).toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        disabled={busy}
                        onClick={() => revokeLicenseKey(lic.id, "license")}
                        className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-400 hover:bg-slate-800 disabled:opacity-40"
                      >
                        Revoke
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => deleteLicenseKey(lic.id, "license")}
                        className="rounded-lg border border-rose-900/30 bg-rose-500/10 px-2.5 py-1 text-xs text-rose-400 hover:bg-rose-500/20 disabled:opacity-40"
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
          )}

          {section === "sessions" && (
            <div className="animate-fade-in">
              {/* resolve box */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                <h3 className="text-sm font-semibold text-slate-200">Check a session ID</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Paste any session ID to see which Minecraft account it belongs to.
                </p>
                <div className="mt-3 flex gap-2">
                  <input
                    value={checkInput}
                    onChange={(e) => setCheckInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && checkSid()}
                    placeholder="Paste a session ID…"
                    className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 font-mono text-xs text-slate-100 placeholder:text-slate-600 outline-none focus:border-fuchsia-500/60"
                  />
                  <button
                    onClick={() => void checkSid()}
                    disabled={checkBusy || !checkInput.trim()}
                    className="rounded-xl bg-fuchsia-600 px-5 py-2.5 text-xs font-bold text-white transition hover:bg-fuchsia-500 disabled:opacity-50"
                  >
                    {checkBusy ? "Checking…" : "Check"}
                  </button>
                </div>
                {checkResult && (
                  <p className={`mt-3 rounded-lg px-3 py-2 text-xs ${checkResult.ok ? "bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20" : "bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/20"}`}>
                    {checkResult.text}
                  </p>
                )}
              </div>

              {/* all sessions */}
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">
                    All bot session IDs
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {sessions.filter((r) => r.status === "online").length} connected · {sessions.length} total · newest first
                  </p>
                  <div className="mt-2 flex gap-1.5">
                    {([
                      { id: "all", label: "All" },
                      { id: "connected", label: "Connected only" },
                    ] as { id: "all" | "connected"; label: string }[]).map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setSessionFilter(f.id)}
                        className={`rounded-full px-3 py-1 text-[11px] font-medium transition ${
                          sessionFilter === f.id
                            ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                            : "bg-slate-800 text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={sessionSearch}
                    onChange={(e) => setSessionSearch(e.target.value)}
                    placeholder="Search owner, ign, server…"
                    className="rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs text-slate-100 placeholder:text-slate-600 outline-none focus:border-fuchsia-500/60"
                  />
                  <button
                    onClick={() => void loadSessions()}
                    className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-medium text-slate-400 transition hover:text-slate-100"
                    title="Refresh"
                  >
                    ⟳
                  </button>
                </div>
              </div>

              <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900/70 text-[10px] uppercase tracking-widest text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Owner</th>
                      <th className="px-4 py-2.5 font-medium">Account</th>
                      <th className="px-4 py-2.5 font-medium">Session ID</th>
                      <th className="px-4 py-2.5 font-medium">Server</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 bg-slate-900/30">
                    {!sessionsLoaded ? (
                      <tr><td colSpan={6} className="px-4 py-6"><SkeletonTable n={4} /></td></tr>
                    ) : sessions.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No bots yet.</td></tr>
                    ) : (
                      sessions
                        .filter((r) => sessionFilter === "all" || r.status === "online")
                        .filter((r) => {
                          const q = sessionSearch.trim().toLowerCase();
                          if (!q) return true;
                          return (
                            r.owner.toLowerCase().includes(q) ||
                            (r.username || "").toLowerCase().includes(q) ||
                            r.host.toLowerCase().includes(q)
                          );
                        })
                        .map((r) => (
                          <tr key={r.id} className="text-slate-300">
                            <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-white">{r.owner}</td>
                            <td className="whitespace-nowrap px-4 py-2.5">{r.username || "—"}</td>
                            <td className="max-w-[280px] px-4 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-400">
                                  {revealed.has(r.id) ? r.token : r.token.slice(0, 14) + "••••••••" + r.token.slice(-6)}
                                </code>
                                <button
                                  onClick={() => toggleReveal(r.id)}
                                  className="shrink-0 rounded bg-slate-800 px-1.5 py-1 text-[10px] text-slate-400 transition hover:text-slate-100"
                                  title={revealed.has(r.id) ? "Hide" : "Reveal"}
                                >
                                  {revealed.has(r.id) ? "hide" : "show"}
                                </button>
                                <button
                                  onClick={() => copySid(r.id, r.token)}
                                  className="shrink-0 rounded bg-slate-800 px-1.5 py-1 text-[10px] text-slate-400 transition hover:text-slate-100"
                                  title="Copy session ID"
                                >
                                  {copiedSid === r.id ? "✓" : "copy"}
                                </button>
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-slate-400">
                              {r.host}
                              <span className="ml-1.5 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">{r.engine}</span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5">
                              <span className={`font-medium ${r.status === "online" ? "text-emerald-400" : r.status === "error" ? "text-rose-400" : "text-slate-500"}`}>
                                {r.status}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">
                              {new Date(r.createdAt).toLocaleDateString()}
                            </td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {section === "shop" && (
            <div className="animate-fade-in">
      {/* Shop Management */}
      <div className="mt-10">
        <div className="relative overflow-hidden rounded-[20px] border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.08] via-indigo-500/[0.05] to-slate-900/60 p-[1px]">
          <div className="rounded-[19px] bg-slate-900/90 backdrop-blur">
            <div className="flex items-center gap-3 px-6 py-5">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-[0_0_20px_rgba(99,102,241,0.3)]"><CartIcon size={20} /></div>
              <div className="flex-1">
                <h3 className="text-[15px] font-bold tracking-tight text-white">Shop Management</h3>
                <p className="text-xs text-slate-400">Manage $5 / $8 / $15 plans, discounts, owner LTC address, and invoices</p>
              </div>
            </div>

            {/* Owner LTC */}
            <div className="border-y border-slate-800/60 bg-slate-900/60 px-6 py-4">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Owner&apos;s LTC Address (funds forwarded here)</label>
              <div className="mt-2 flex gap-2">
                <input
                  value={newOwnerLtc}
                  onChange={(e) => setNewOwnerLtc(e.target.value)}
                  placeholder="L..."
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 font-mono text-xs text-white outline-none focus:border-violet-500/50"
                />
                <button
                  disabled={busy}
                  onClick={async () => {
                    if (!newOwnerLtc.trim()) return toast("Enter address", "error");
                    setBusy(true);
                    try {
                      const res = await fetch("/api/shop/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ownerLtcAddress: newOwnerLtc.trim() }) });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error);
                      setOwnerLtc(data.ownerLtcAddress);
                      toast("Owner LTC saved", "success");
                    } catch (e: any) { toast(e.message || "Something went wrong", "error"); } finally { setBusy(false); }
                  }}
                  className="rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">Current: <span className="font-mono text-slate-300">{ownerLtc || "not set"}</span> – payments from generated invoice addresses will be forwarded here (simulated, logs in server)</p>
            </div>

            {/* Plans */}
            <div className="p-6">
              <h4 className="text-sm font-semibold text-white">Plans (editable)</h4>
              <div className="mt-3 grid gap-3">
                {shopPlans.map((p: any) => (
                  <div key={p.id} className="rounded-xl border border-slate-700 bg-slate-950/60 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-white">{p.tier}</span>
                      <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">${p.price} {p.discount > 0 && `( -${p.discount}% = $${p.finalPrice} )`}</span>
                      <span className="text-xs text-slate-500">{p.bots} bots / {p.hours}h</span>
                      {p.popular && <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] text-indigo-300">popular</span>}
                      <span className={`ml-auto h-2 w-2 rounded-full ${p.active ? "bg-emerald-400" : "bg-slate-600"}`} />
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-4">
                      <input type="number" step="0.01" value={p.price} onChange={(e) => {
                        const v = Number(e.target.value);
                        setShopPlans(prev => prev.map(x => x.id === p.id ? { ...x, price: v, finalPrice: Math.round(v * (1 - x.discount/100)*100)/100 } : x));
                      }} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs" placeholder="price" />
                      <input type="number" value={p.bots} onChange={(e) => setShopPlans(prev => prev.map(x => x.id === p.id ? { ...x, bots: Number(e.target.value) } : x))} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs" placeholder="bots" />
                      <input type="number" value={p.hours} onChange={(e) => setShopPlans(prev => prev.map(x => x.id === p.id ? { ...x, hours: Number(e.target.value) } : x))} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs" placeholder="hours" />
                      <input type="number" value={p.discount} onChange={(e) => setShopPlans(prev => prev.map(x => x.id === p.id ? { ...x, discount: Number(e.target.value), finalPrice: Math.round(x.price * (1 - Number(e.target.value)/100)*100)/100 } : x))} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs" placeholder="discount %" />
                    </div>
                    <div className="mt-2 flex gap-2">
                      <label className="flex items-center gap-1 text-xs text-slate-400">
                        <input type="checkbox" checked={p.popular} onChange={(e) => setShopPlans(prev => prev.map(x => x.id === p.id ? { ...x, popular: e.target.checked } : x))} /> Popular
                      </label>
                      <label className="flex items-center gap-1 text-xs text-slate-400">
                        <input type="checkbox" checked={p.active} onChange={(e) => setShopPlans(prev => prev.map(x => x.id === p.id ? { ...x, active: e.target.checked } : x))} /> Active
                      </label>
                      <button
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const res = await fetch(`/api/shop/plans/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ price: p.price, bots: p.bots, hours: p.hours, discount: p.discount, popular: p.popular, active: p.active }) });
                            if (!res.ok) throw new Error((await res.json()).error);
                          } catch (e: any) { toast(e.message || "Something went wrong", "error"); } finally { setBusy(false); }
                        }}
                        className="ml-auto rounded-lg bg-slate-800 px-3 py-1 text-xs text-slate-200 hover:bg-slate-700"
                      >
                        Save
                      </button>
                      <button
                        disabled={busy}
                        onClick={async () => {
                          if (!confirm("Delete plan?")) return;
                          setBusy(true);
                          try {
                            await fetch(`/api/shop/plans/${p.id}`, { method: "DELETE" });
                            setShopPlans(prev => prev.filter(x => x.id !== p.id));
                          } finally { setBusy(false); }
                        }}
                        className="rounded-lg border border-rose-900/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-400"
                      >
                        Del
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <h5 className="text-xs font-semibold text-white">Add a new plan</h5>
                <p className="mt-1 text-[11px] text-slate-500">Fills the shop with a new tier buyers can purchase.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <PlanField label="Tier name" hint="shown in the shop">
                    <input value={newPlanTier} onChange={(e) => setNewPlanTier(e.target.value)} placeholder="e.g. PRO" className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600" />
                  </PlanField>
                  <PlanField label="Price" hint="$ per month">
                    <input type="number" step="0.01" value={newPlanPrice} onChange={(e) => setNewPlanPrice(Number(e.target.value))} placeholder="e.g. 5" className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600" />
                  </PlanField>
                  <PlanField label="Discount" hint="% off — 0 for none">
                    <input type="number" value={newPlanDiscount} onChange={(e) => setNewPlanDiscount(Number(e.target.value))} placeholder="0" className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600" />
                  </PlanField>
                  <PlanField label="Bot slots" hint="bots the buyer can run">
                    <input type="number" value={newPlanBots} onChange={(e) => setNewPlanBots(Number(e.target.value))} placeholder="e.g. 3" className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600" />
                  </PlanField>
                  <PlanField label="Runtime" hint="hours per day">
                    <input type="number" value={newPlanHours} onChange={(e) => setNewPlanHours(Number(e.target.value))} placeholder="e.g. 6" className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600" />
                  </PlanField>
                  <div>
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Badge</span>
                    <label className="mt-2 flex h-[34px] cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-300">
                      <input type="checkbox" checked={newPlanPopular} onChange={(e) => setNewPlanPopular(e.target.checked)} className="accent-violet-500" />
                      Mark as Most Popular
                    </label>
                  </div>
                </div>
                <div className="mt-3">
                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Features</span>
                  <input value={newPlanFeatures} onChange={(e) => setNewPlanFeatures(e.target.value)} placeholder="comma separated — e.g. 3 bots, 6h/day, priority support" className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600" />
                  <p className="mt-1 text-[10px] text-slate-500">Each item becomes a checkmark line on the plan card in the shop.</p>
                </div>
                <button
                  disabled={busy || !newPlanTier}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const feats = newPlanFeatures.split(",").map(s => s.trim()).filter(Boolean);
                      const res = await fetch("/api/shop/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tier: newPlanTier, price: newPlanPrice, bots: newPlanBots, hours: newPlanHours, features: feats, discount: newPlanDiscount, popular: newPlanPopular }) });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error);
                      setShopPlans(prev => [...prev, { ...data.plan, features: feats, popular: newPlanPopular, active: true, finalPrice: Math.round(newPlanPrice * (1 - newPlanDiscount/100)*100)/100 }]);
                      setNewPlanTier(""); setNewPlanFeatures("");
                    } catch (e: any) { toast(e.message || "Something went wrong", "error"); } finally { setBusy(false); }
                  }}
                  className="mt-3 rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-50"
                >
                  Add plan
                </button>
              </div>

              <div className="mt-6">
                <h5 className="text-xs font-semibold text-slate-400">Recent invoices (LTC)</h5>
                <div className="mt-2 max-h-[320px] space-y-2 overflow-auto">
                  {shopInvoices.length === 0 ? <p className="text-xs text-slate-600">No invoices</p> : shopInvoices.slice(0, 20).map((inv: any) => (
                    <div key={inv.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px]">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`h-1.5 w-1.5 rounded-full ${inv.status === "paid" || inv.status === "forwarded" ? "bg-emerald-400" : inv.status === "pending" ? "bg-amber-400 animate-pulse" : "bg-slate-600"}`} />
                          <span className="font-mono text-slate-300">{inv.ltcAddress.slice(0, 18)}…</span>
                          <span className="text-slate-500">${inv.amountUSD} ≈ {inv.amountLTC} LTC</span>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] ${inv.status === "paid" ? "bg-emerald-500/15 text-emerald-300" : inv.status === "pending" ? "bg-amber-500/15 text-amber-300" : "bg-slate-700 text-slate-400"}`}>{inv.status}</span>
                        </div>
                        <div className="mt-1 text-[10px] text-slate-600">{new Date(inv.createdAt).toLocaleString()} · owner → {inv.ownerLtcAddress.slice(0, 16)}… {inv.licenseKey && <span className="text-amber-300">· key {inv.licenseKey.slice(0, 16)}…</span>}</div>
                      </div>
                      <div className="ml-2 flex gap-1">
                        {inv.status === "pending" && (
                          <button
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                const res = await fetch(`/api/shop/invoices/${inv.id}/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ forcePaid: true }) });
                                const data = await res.json();
                                if (data.paid) toast(`Marked paid — key: ${data.licenseKey}`, "success");
                                else toast("Not paid yet", "info");
                              } finally { setBusy(false); }
                            }}
                            className="rounded bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300 ring-1 ring-amber-500/20"
                          >
                            Force paid
                          </button>
                        )}
                        {inv.licenseKey && <button onClick={() => navigator.clipboard.writeText(inv.licenseKey)} className="rounded bg-slate-800 px-2 py-1 text-[10px]">Copy key</button>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
            </div>
          )}
        </div>
      </div>

      {section === "adminbot" && (
        <div className="animate-fade-in">
          {/* status */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 text-white shadow-lg shadow-emerald-900/40">
                  <BotFaceIcon />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Admin Bot</h3>
                  <p className="text-xs text-slate-400">Your Discord server bot — tickets, licenses, embeds and site logging.</p>
                </div>
              </div>
              {botStatus && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {botStatus.running ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 font-semibold text-emerald-300">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Online
                    </span>
                  ) : botStatus.starting ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 font-semibold text-amber-300">Starting…</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1.5 font-semibold text-slate-400">Offline</span>
                  )}
                  {botStatus.running && (
                    <>
                      <span className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-slate-300">{botStatus.tag}</span>
                      <span className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-slate-400">{botStatus.guildCount} server{botStatus.guildCount === 1 ? "" : "s"}</span>
                      <span className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-slate-400">up {botUptime(botStatus.uptimeSec)}</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {botStatus?.degraded && (
              <p className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                Message Content Intent is off in the Discord Developer Portal — the bot runs, but ticket transcripts
                won&apos;t include message text. Enable it under Bot → Privileged Gateway Intents for full transcripts.
              </p>
            )}
            {botStatus?.lastError && !botStatus.running && (
              <p className="mt-4 break-words rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {botStatus.lastError}
              </p>
            )}
            {botStatus?.inviteUrl && (
              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Invite link</p>
                <p className="mt-1 text-xs text-slate-400">Open this in a browser (owner account) to add the bot to your server:</p>
                <a href={botStatus.inviteUrl} target="_blank" rel="noreferrer" className="mt-2 block break-all font-mono text-xs text-emerald-300 underline decoration-emerald-500/40 hover:text-emerald-200">
                  {botStatus.inviteUrl}
                </a>
              </div>
            )}
          </div>

          {/* token + site url */}
          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <h4 className="text-sm font-semibold text-white">Bot token</h4>
            <p className="mt-1 text-xs text-slate-500">
              Discord Developer Portal → your app → Bot → Reset Token. Stored server-side only, never shown again.
              {botStatus?.hasToken ? ` A token is saved (${botStatus.tokenHint}).` : ""}
            </p>
            <input
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder={botStatus?.hasToken ? "Paste a new token to replace the saved one" : "Paste the bot token"}
              autoComplete="off"
              className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600"
            />
            <div className="mt-4">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Site URL</label>
              <input
                value={botSiteUrl}
                onChange={(e) => setBotSiteUrl(e.target.value)}
                placeholder="https://your-site.up.railway.app"
                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600"
              />
              <p className="mt-1 text-[10px] text-slate-500">Used by Discord buttons like Renew Now and Buy License.</p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => void startAdminBot()}
                disabled={botBusy || (!botToken.trim() && !botStatus?.hasToken)}
                className="btn-primary rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-bold text-emerald-950 hover:bg-emerald-400 disabled:opacity-40"
              >
                {botBusy ? "Working…" : botStatus?.hasToken ? "Save & restart bot" : "Save & start bot"}
              </button>
              <button
                onClick={() => void stopAdminBot(false)}
                disabled={botBusy || !botStatus?.running}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40"
              >
                Stop bot
              </button>
              <button
                onClick={() => void stopAdminBot(true)}
                disabled={botBusy || !botStatus?.hasToken}
                className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-2.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 disabled:opacity-40"
              >
                Stop & forget token
              </button>
            </div>
            <p className="mt-3 text-[10px] text-slate-500">The bot auto-starts again after every deploy while a token is saved.</p>
          </div>

          {/* setup */}
          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <h4 className="text-sm font-semibold text-white">Setup</h4>
            <ol className="mt-3 space-y-2 text-xs text-slate-400">
              <li className="flex gap-2"><span className="font-semibold text-emerald-400">1.</span> Create an application at the Discord Developer Portal and open its Bot page.</li>
              <li className="flex gap-2"><span className="font-semibold text-emerald-400">2.</span> Enable <span className="text-slate-200">Message Content Intent</span> under Privileged Gateway Intents (needed for ticket transcripts).</li>
              <li className="flex gap-2"><span className="font-semibold text-emerald-400">3.</span> Reset Token, paste it above and press Save &amp; start — the invite link appears on this page.</li>
              <li className="flex gap-2"><span className="font-semibold text-emerald-400">4.</span> Open the invite link with your server owner account to add the bot.</li>
              <li className="flex gap-2"><span className="font-semibold text-emerald-400">5.</span> In Discord, run <code className="rounded bg-slate-800 px-1.5 py-0.5 text-emerald-300">/setup-logs</code> once to create the event log channels.</li>
            </ol>
          </div>

          {/* commands */}
          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <h4 className="text-sm font-semibold text-white">Commands</h4>
            <div className="mt-3 divide-y divide-slate-800/60">
              {([
                ["/ticket-panel", "Admin", "Post the support ticket panel with category dropdown"],
                ["/license", "Everyone", "Show your license, quota and expiry as a private card"],
                ["/redeem", "Everyone", "Redeem a license key — syncs with the web dashboard instantly"],
                ["/admin-generate-license", "Admin", "Generate a license key (tier, slots, duration like 30d or 12h)"],
                ["/announce", "Admin", "Post a clean announcement embed with a dashboard button"],
                ["/changelog", "Admin", "Post a versioned changelog (Added / Fixed / Improved sections)"],
                ["/purchase-panel", "Admin", "Post the plan showcase embed with a Buy License button"],
                ["/setup-logs", "Admin", "Create the log channels (signups, purchases, bots, errors)"],
                ["/rename-smooth-channel", "Admin", "Rename this channel to a clean emoji-prefixed name"],
                ["/purge", "Admin", "Bulk delete recent messages — filter by user, text or bots only"],
                ["/bots", "Everyone", "List your bots with online/offline status"],
              ] as [string, string, string][]).map(([cmd, who, desc]) => (
                <div key={cmd} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <code className="rounded bg-slate-800 px-2 py-0.5 text-xs font-semibold text-emerald-300">{cmd}</code>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${who === "Admin" ? "bg-amber-500/15 text-amber-300" : "bg-slate-700 text-slate-300"}`}>{who}</span>
                  <span className="text-xs text-slate-400">{desc}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[10px] text-slate-500">
              Admin commands accept the server owner, members with Administrator permission, and accounts linked to a
              website admin. Tickets close with the in-channel buttons; the Claim button is owner-only. Log channels are
              private to you, staff roles and the bot. Expiry reminder DMs go out 5 days and 1 day before a license ends.
            </p>
          </div>

          {/* log channels */}
          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <h4 className="text-sm font-semibold text-white">Event logging</h4>
            <p className="mt-1 text-xs text-slate-500">Website events land in these channels while the bot is online (webhook is used as fallback when it&apos;s offline).</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {([
                ["logs-signups", "New account registrations"],
                ["logs-purchases", "License activations, redemptions and paid invoices"],
                ["logs-bots", "Bot created, started, stopped and deleted"],
                ["logs-errors", "Critical backend failures"],
              ] as [string, string][]).map(([name, desc]) => (
                <div key={name} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                  <code className="text-xs font-semibold text-emerald-300">#{name}</code>
                  <p className="mt-1 text-[11px] text-slate-500">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* admin: edit any bot's config */}
      {manageBot && (
        <EditBotModal
          bot={manageBot as unknown as BotItem}
          canEditEngine
          onClose={() => setManageBot(null)}
          onSaved={() => {
            setManageBot(null);
            if (expanded) loadBots(expanded);
          }}
        />
      )}
    </div>
  );
}

function ShieldCheck() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function PlanField({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
      <span className="mt-1 block text-[10px] text-slate-500">{hint}</span>
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
