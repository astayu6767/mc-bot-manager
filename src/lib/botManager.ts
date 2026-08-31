import crypto from "crypto";
import { db } from "@/db";
import { bots, type Bot } from "@/db/schema";
import { eq } from "drizzle-orm";
import { startAzaleaBot, type AzaleaRuntime } from "@/lib/azaleaEngine";

const globalForResume = globalThis as typeof globalThis & {
  __mcBotsResumed?: boolean;
};

// On server (re)start, reconnect every bot the user left enabled. Runs once.
export async function resumeEnabledBots(): Promise<void> {
  if (globalForResume.__mcBotsResumed) return;
  globalForResume.__mcBotsResumed = true;
  try {
    const enabled = await db
      .select()
      .from(bots)
      .where(eq(bots.enabled, "true"));
    for (const record of enabled) {
      // Stagger reconnects slightly so we don't hammer the auth/services API.
      setTimeout(
        () => {
          void startBot(record);
        },
        500 + Math.random() * 2500,
      );
    }
  } catch {
    // ignore — DB may not be ready yet
  }
}

export type BotStatus = "offline" | "connecting" | "online" | "error";

export type LogEntry = {
  ts: number;
  level: "info" | "chat" | "error" | "system";
  line: string;
};

type BotRuntime = {
  id: string;
  status: BotStatus;
  joined: boolean;
  lastError: string | null;
  logs: LogEntry[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bot: any | null;
  manualStop: boolean;
  using: boolean;
  beaming: boolean;
  beamStage: string;
  beamLoop: boolean;
  humanizer: ReturnType<typeof setTimeout> | null;
  nmpPlayers: Set<string>;
  azaleaChild: import("child_process").ChildProcess | null;
  azaleaSnap: import("@/app/types").ViewSnapshot | null;
};

const MAX_LOGS = 300;

const globalForBots = globalThis as typeof globalThis & {
  __mcBotRuntimes?: Map<string, BotRuntime>;
};

const runtimes: Map<string, BotRuntime> =
  globalForBots.__mcBotRuntimes ?? new Map();
globalForBots.__mcBotRuntimes = runtimes;

function getOrCreateRuntime(id: string): BotRuntime {
  let rt = runtimes.get(id);
  if (!rt) {
    rt = {
      id,
      status: "offline",
      joined: false,
      lastError: null,
      logs: [],
      bot: null,
      manualStop: false,
      using: false,
      beaming: false,
      beamStage: "",
      beamLoop: false,
      humanizer: null,
      nmpPlayers: new Set<string>(),
      azaleaChild: null,
      azaleaSnap: null,
    };
    runtimes.set(id, rt);
  }
  return rt;
}

function shouldFilterLog(line: string): boolean {
  const lower = line.toLowerCase();
  const filters = [
    "more than 1,000 items",
    "packet-event",
    "error reading packet",
    "explode (id 36)",
    "failed to fill whole buffer",
    "packet explode",
    "azalea_client::plugins::connection",
  ];
  return filters.some((f) => lower.includes(f));
}

function log(rt: BotRuntime, level: LogEntry["level"], line: string) {
  if (shouldFilterLog(line)) {
    console.debug(`[filtered bot log] ${line}`);
    return;
  }
  rt.logs.push({ ts: Date.now(), level, line });
  if (rt.logs.length > MAX_LOGS) {
    rt.logs.splice(0, rt.logs.length - MAX_LOGS);
  }
}

async function setDbStatus(
  id: string,
  status: BotStatus,
  lastError: string | null = null,
) {
  try {
    await db.update(bots).set({ status, lastError }).where(eq(bots.id, id));
  } catch {
    // ignore db errors for status sync
  }
}

type ProxyConfig = {
  type: 4 | 5;
  host: string;
  port: number;
  userId?: string;
  password?: string;
};

// Parse strings like:
//   socks5://user:pass@1.2.3.4:1080
//   socks4://1.2.3.4:1080
//   1.2.3.4:1080   (defaults to socks5)
function parseProxy(raw: string | null | undefined): ProxyConfig | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  let type: 4 | 5 = 5;
  let rest = s;
  const schemeMatch = s.match(/^(socks5h?|socks4|socks):\/\//i);
  if (schemeMatch) {
    type = /4/.test(schemeMatch[1]) ? 4 : 5;
    rest = s.slice(schemeMatch[0].length);
  }
  let userId: string | undefined;
  let password: string | undefined;
  const atIdx = rest.lastIndexOf("@");
  if (atIdx > -1) {
    const cred = rest.slice(0, atIdx);
    rest = rest.slice(atIdx + 1);
    const ci = cred.indexOf(":");
    if (ci > -1) {
      userId = cred.slice(0, ci);
      password = cred.slice(ci + 1);
    } else {
      userId = cred;
    }
  }
  const colon = rest.lastIndexOf(":");
  if (colon < 0) return null;
  const host = rest.slice(0, colon);
  const port = Number(rest.slice(colon + 1));
  if (!host || !Number.isFinite(port) || port <= 0 || port >= 65536) return null;
  return { type, host, port, userId, password };
}

type MinecraftProfile = { id: string; name: string };

function decodeJwtPayload(token: string): Record<string, any> | null {
  try { 
    const parts = token.split("."); 
    if (parts.length < 2) return null; 
    return JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8")); 
  } catch { 
    return null; 
  }
}

async function resolveProfile(token: string): Promise<MinecraftProfile> {
  // 1. Try decoding the profile directly from the token (Yggdrasil / SSID format)
  const payload = decodeJwtPayload(token);
  if (payload) { 
    const pfd = payload.pfd as Array<{ type: string; id: string; name: string }> | undefined; 
    if (pfd && Array.isArray(pfd)) { 
      const mc = pfd.find(p => p.type === "mc"); 
      if (mc) return { name: mc.name, id: mc.id }; 
    } 
  }

  // 2. Fallback to Minecraft API fetch
  const res = await fetch(
    "https://api.minecraftservices.com/minecraft/profile",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Token rejected by Minecraft services (HTTP ${res.status}). ${text.slice(0, 140)}`,
    );
  }
  const data = (await res.json()) as { id?: string; name?: string };
  if (!data.id || !data.name) {
    throw new Error("Minecraft profile response missing id/name");
  }
  return { id: data.id, name: data.name };
}

// Convert a PEM block to DER bytes (matches prismarine-auth's helper).
function toDER(pem: string): Buffer {
  return pem
    .split("\n")
    .slice(1, -1)
    .reduce(
      (acc, cur) => Buffer.concat([acc, Buffer.from(cur, "base64")]),
      Buffer.alloc(0),
    );
}

// Fetch the account's chat-signing key pair so the bot can join 1.19+ servers
// that enforce secure chat and can send/receive signed messages.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchProfileKeys(token: string): Promise<any> {
  const res = await fetch(
    "https://api.minecraftservices.com/player/certificates",
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    throw new Error(`certificates HTTP ${res.status}`);
  }
  const cert = (await res.json()) as {
    keyPair: { publicKey: string; privateKey: string };
    publicKeySignature?: string;
    publicKeySignatureV2?: string;
    expiresAt: string;
    refreshedAfter: string;
  };
  const publicDER = toDER(cert.keyPair.publicKey);
  const privateDER = toDER(cert.keyPair.privateKey);
  return {
    publicPEM: cert.keyPair.publicKey,
    privatePEM: cert.keyPair.privateKey,
    publicDER,
    privateDER,
    signature: cert.publicKeySignature
      ? Buffer.from(cert.publicKeySignature, "base64")
      : undefined,
    signatureV2: cert.publicKeySignatureV2
      ? Buffer.from(cert.publicKeySignatureV2, "base64")
      : undefined,
    expiresOn: new Date(cert.expiresAt),
    refreshAfter: new Date(cert.refreshedAfter),
    public: crypto.createPublicKey({
      key: publicDER,
      format: "der",
      type: "spki",
    }),
    private: crypto.createPrivateKey({
      key: privateDER,
      format: "der",
      type: "pkcs8",
    }),
  };
}

// --- Humanizer: subtle, randomized idle behaviour so the bot doesn't move/act
// like a perfectly static machine. This mimics a real player's tiny head
// movements and natural timing variance. (Helps on normal servers; it does
// NOT defeat hardened paid anticheat like mcpvp.)
function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function humanGap(base: number, spread = 0.25): number {
  // Returns base ms +/- a random spread so timings never look robotic.
  const delta = base * spread;
  return Math.max(120, Math.round(base + rand(-delta, delta)));
}

function startHumanizer(rt: BotRuntime) {
  stopHumanizer(rt);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bot: any = rt.bot;
  if (!bot) return;

  const tick = () => {
    try {
      if (
        bot &&
        bot.entity &&
        rt.status === "online" &&
        // Don't fight the beam's deliberate movements.
        !rt.beaming
      ) {
        // Occasionally make a tiny, natural head movement.
        if (Math.random() < 0.6) {
          const yaw = (bot.entity.yaw ?? 0) + rand(-0.35, 0.35);
          const pitch = Math.max(
            -1.2,
            Math.min(1.2, (bot.entity.pitch ?? 0) + rand(-0.18, 0.18)),
          );
          bot.look(yaw, pitch, false);
        }
        // Rare micro sneak-tap (very human, harmless).
        if (Math.random() < 0.05) {
          bot.setControlState("sneak", true);
          setTimeout(() => {
            try {
              bot.setControlState("sneak", false);
            } catch {
              // ignore
            }
          }, rand(120, 320));
        }
      }
    } catch {
      // ignore
    }
    rt.humanizer = setTimeout(tick, humanGap(3500, 0.5));
  };
  rt.humanizer = setTimeout(tick, humanGap(3000, 0.5));
}

function stopHumanizer(rt: BotRuntime) {
  if (rt.humanizer) {
    clearTimeout(rt.humanizer);
    rt.humanizer = null;
  }
}

export function getRuntimeView(id: string) {
  const rt = runtimes.get(id);
  if (!rt) {
    return {
      status: "offline" as BotStatus,
      joined: false,
      lastError: null as string | null,
    };
  }
  return { status: rt.status, joined: rt.joined, lastError: rt.lastError };
}

export function getLogs(id: string): LogEntry[] {
  const rt = runtimes.get(id);
  return rt ? rt.logs : [];
}

async function startRawNmpBot(record: Bot, rt: BotRuntime) {
  let mc: typeof import("minecraft-protocol");
  try {
    mc = await import("minecraft-protocol");
  } catch (err) {
    const msg = "Failed to load minecraft-protocol: " + String(err);
    rt.status = "error";
    rt.lastError = msg;
    log(rt, "error", msg);
    await setDbStatus(record.id, "error", msg);
    return;
  }

  const usePinnedVersion = record.version && record.version !== "auto" ? record.version : false;

  let profile: MinecraftProfile;
  try {
    log(rt, "system", "Validating Minecraft token...");
    profile = await resolveProfile(record.token);
    log(rt, "system", `Authenticated as ${profile.name} (${profile.id}).`);
    await db.update(bots).set({ username: profile.name, uuid: profile.id }).where(eq(bots.id, record.id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    rt.status = "error";
    rt.lastError = msg;
    log(rt, "error", msg);
    await setDbStatus(record.id, "error", msg);
    return;
  }

  // Pre-fetch chat-signing certificates for NMP mode too.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let profileKeys: any = null;
  try {
    profileKeys = await fetchProfileKeys(record.token);
    log(rt, "system", "Fetched chat-signing certificates.");
  } catch {
    log(rt, "system", "Could not fetch chat certificates (continuing without chat signing).");
  }

  try {
    const client = mc.createClient({
      host: record.host,
      port: record.port,
      version: usePinnedVersion,
      username: profile.name,
      keepAlive: true,
      checkTimeoutInterval: 600000, // 10 min
      hideErrors: true,
      auth: function (this: any, _client: any, options: any) {
        const session = {
          accessToken: record.token,
          clientToken: crypto.randomUUID(),
          selectedProfile: { name: profile.name, id: profile.id },
        };
        _client.session = session;
        _client.username = profile.name;
        options.accessToken = record.token;
        options.haveCredentials = true;
        if (profileKeys) _client.profileKeys = profileKeys;
        _client.emit("session", session);
        options.connect(_client);
      },
    } as any);

    rt.bot = client;
    
    client.chat = (message: string) => {
      const isCmd = message.startsWith("/");
      try {
        client.write("chat", { message });
      } catch {
        try {
          if (isCmd) {
            client.write("chat_command", { 
              command: message.slice(1), 
              timestamp: BigInt(Date.now()), 
              salt: BigInt(0), 
              argumentSignatures: [], 
              signedPreview: false, 
              messageCount: 0, 
              acknowledged: Buffer.alloc(3), 
              previousMessages: [] 
            });
          } else {
            client.write("chat_message", { 
              message, 
              timestamp: BigInt(Date.now()), 
              salt: BigInt(0), 
              signature: Buffer.alloc(0), 
              signedPreview: false, 
              messageCount: 0, 
              acknowledged: Buffer.alloc(3), 
              previousMessages: [] 
            });
          }
        } catch {}
      }
    };

    client.on("connect", () => log(rt, "system", "TCP connected."));
    client.on("session", () => log(rt, "system", "Session confirmed."));

    client.on("login", () => {
      rt.status = "online";
      rt.joined = true;
      rt.lastError = null;
      log(rt, "system", `✅ Logged in as ${profile.name} (Raw NMP Mode).`);
      void setDbStatus(record.id, "online");

      // Their Anti-AFK & settings bypass snippet
      try {
        client.write("settings", { locale: "en_US", viewDistance: 8, chatMode: 0, chatColors: true, skinParts: 0x7f, mainHand: 1, enableTextFiltering: false, allowServerListings: true });
      } catch {}

      let lastAction = 0;
      const actions = [
        () => { try { client.write("entity_action", { entityId: 0, actionId: 0, jumpBoost: 0 }); setTimeout(() => { try { client.write("entity_action", { entityId: 0, actionId: 1, jumpBoost: 0 }); } catch {} }, 300); } catch {} }, // sneak
        () => { try { client.write("entity_action", { entityId: 0, actionId: 4, jumpBoost: 0 }); setTimeout(() => { try { client.write("entity_action", { entityId: 0, actionId: 5, jumpBoost: 0 }); } catch {} }, 200); } catch {} }, // start/stop jumping
      ];

      const antiAfk = setInterval(() => {
        try {
          if (rt.status !== "online") { clearInterval(antiAfk); return; }
          const action = actions[lastAction % actions.length];
          action();
          lastAction++;
        } catch { clearInterval(antiAfk); }
      }, 15000 + Math.random() * 15000); // 15-30s random interval
    });

    // The user's exact chat parsing snippet for NMP
    client.on("playerChat", (data: any) => {
      let sender = ""; 
      if (typeof data.senderName === "string") sender = data.senderName; 
      else if (typeof data.sender === "string") sender = data.sender; 
      sender = sender || "Unknown";
      
      if (sender && sender !== "Unknown" && isValidUsername(sender)) {
        rt.nmpPlayers.add(sender);
      }

      let content = data.plainMessage || data.unsignedChat || "";
      if (!content && data.formattedMessage) { 
        try { content = extractText(JSON.parse(data.formattedMessage)); } 
        catch { content = String(data.formattedMessage); } 
      }
      if (sender === profile.name && content) return;
      if (content) {
        log(rt, "chat", `<${sender}> ${content}`);
        client.emit("messagestr", `<${sender}> ${content}`);
      }
    });

    client.on("systemChat", (data: any) => {
      let text = ""; 
      try { text = extractText(JSON.parse(data.formattedMessage || data.content)); } 
      catch { text = data.formattedMessage || data.content; }
      if (!text) return;
      
      const pmSent = text.match(/^(You|you)\s*[→>]\s*(\S+)\s*[:：]\s*(.+)$/) || text.match(/^You whisper to (\S+): (.+)$/i);
      const pmRecv = text.match(/^(\S+)\s*[→>]\s*(You|you)\s*[:：]\s*(.+)$/) || text.match(/^(\S+) whispers? (?:to you)?: (.+)$/i) || text.match(/^From (\S+): (.+)$/i);
      
      if (pmRecv && pmRecv[1] && isValidUsername(pmRecv[1])) {
        rt.nmpPlayers.add(pmRecv[1]);
      }

      if (pmSent) {
        const out = `<you → ${pmSent[2]}> ${pmSent[3]}`;
        log(rt, "chat", out);
        client.emit("messagestr", out);
      } else if (pmRecv) {
        const out = `(From ${pmRecv[1]}) ${pmRecv[2]}`;
        log(rt, "chat", out);
        client.emit("messagestr", out);
      } else {
        log(rt, "chat", `${text}`);
        client.emit("messagestr", text);
      }
    });

    client.on("chat", (packet: any) => {
      const raw = typeof packet.message === "string" ? packet.message : JSON.stringify(packet.message);
      let text = ""; 
      try { text = extractText(JSON.parse(raw)); } 
      catch { text = raw; }
      if (!text) return;
      
      const chatMatch = text.match(/^<(.+?)>\s?(.*)$/);
      if (chatMatch) { 
        if (chatMatch[1] && isValidUsername(chatMatch[1])) {
          rt.nmpPlayers.add(chatMatch[1]);
        }
        if (chatMatch[1] === profile.name) return; 
        const out = `<${chatMatch[1]}> ${chatMatch[2]}`;
        log(rt, "chat", out); 
        client.emit("messagestr", out);
        return; 
      }
      
      const pmSent = text.match(/^(You|you)\s*[→>]\s*(\S+)\s*[:：]\s*(.+)$/) || text.match(/^You whisper to (\S+): (.+)$/i);
      const pmRecv = text.match(/^(\S+)\s*[→>]\s*(You|you)\s*[:：]\s*(.+)$/) || text.match(/^(\S+) whispers?: (.+)$/i) || text.match(/^From (\S+): (.+)$/i);
      
      if (pmRecv && pmRecv[1] && isValidUsername(pmRecv[1])) {
        rt.nmpPlayers.add(pmRecv[1]);
      }

      if (pmSent) {
        const out = `<you → ${pmSent[2]}> ${pmSent[3]}`;
        log(rt, "chat", out);
        client.emit("messagestr", out);
      } else if (pmRecv) {
        const out = `(From ${pmRecv[1]}) ${pmRecv[2]}`;
        log(rt, "chat", out);
        client.emit("messagestr", out);
      } else {
        log(rt, "chat", `${text}`);
        client.emit("messagestr", text);
      }
    });
    
    // NMP Kick handling
    client.on("kick_disconnect", (packet: any) => {
      const t = kickReasonToText(packet.reason);
      rt.joined = false;
      rt.status = "error";
      rt.lastError = `Kicked: ${t}`;
      log(rt, "error", rt.lastError);
      void setDbStatus(record.id, "error", rt.lastError);
    });

    client.on("disconnect", (packet: any) => {
      const t = kickReasonToText(packet.reason);
      rt.joined = false;
      rt.status = "error";
      rt.lastError = `Disconnected: ${t}`;
      log(rt, "error", rt.lastError);
      void setDbStatus(record.id, "error", rt.lastError);
    });

    client.on("end", (reason: any) => {
      rt.joined = false;
      rt.bot = null;
      if (rt.manualStop) {
        rt.status = "offline";
        log(rt, "system", "Bot stopped.");
      } else {
        const reasonText = kickReasonToText(reason);
        rt.status = "error";
        rt.lastError = `Disconnected: ${reasonText}`;
        log(rt, "error", rt.lastError);
      }
      void setDbStatus(record.id, rt.status, rt.lastError);
    });

    client.on("error", (err: any) => {
      const msg = err?.message || String(err);
      if (!rt.manualStop) {
        rt.status = "error";
        rt.lastError = msg;
        log(rt, "error", msg);
        void setDbStatus(record.id, "error", msg);
      }
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    rt.status = "error";
    rt.lastError = msg;
    log(rt, "error", msg);
    await setDbStatus(record.id, "error", msg);
  }
}

export async function startBot(record: Bot): Promise<void> {
  const rt = getOrCreateRuntime(record.id);
  rt.manualStop = false;

  // Tear down any existing connection first.
  if (rt.bot) {
    try {
      if (rt.bot.socket && typeof rt.bot.socket.destroy === "function") {
        rt.bot.socket.destroy();
      }
      if (typeof rt.bot.quit === "function") rt.bot.quit();
      else if (typeof rt.bot.end === "function") rt.bot.end("Stopped");
      rt.bot.removeAllListeners();
    } catch {
      // ignore
    }
    rt.bot = null;
  }
  if (rt.azaleaChild) {
    try {
      rt.azaleaChild.kill("SIGKILL");
    } catch {
      // ignore
    }
    rt.azaleaChild = null;
  }
  rt.azaleaSnap = null;

  rt.status = "connecting";
  rt.joined = false;
  rt.lastError = null;
  const versionLabel =
    record.version && record.version !== "auto" ? record.version : "auto-detect";
  log(
    rt,
    "system",
    `Connecting to ${record.host}:${record.port} (version: ${versionLabel}) ...`,
  );
  await setDbStatus(record.id, "connecting");

  // Route to the Azalea (Rust) sidecar or the raw NMP engine if requested.
  if (record.engine === "azalea") {
    return startAzaleaBot(record, rt as AzaleaRuntime, {
      log,
      setDbStatus,
      resolveProfile,
    });
  }
  if (record.engine === "nmp") {
    return startRawNmpBot(record, rt);
  }

  let profile: MinecraftProfile;
  try {
    log(rt, "system", "Validating Minecraft token...");
    profile = await resolveProfile(record.token);
    log(rt, "system", `Authenticated as ${profile.name} (${profile.id}).`);
    await db
      .update(bots)
      .set({ username: profile.name, uuid: profile.id })
      .where(eq(bots.id, record.id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    rt.status = "error";
    rt.lastError = msg;
    log(rt, "error", msg);
    await setDbStatus(record.id, "error", msg);
    return;
  }

  let mineflayer: typeof import("mineflayer");
  try {
    mineflayer = await import("mineflayer");
  } catch (err) {
    const msg =
      "Failed to load mineflayer: " +
      (err instanceof Error ? err.message : String(err));
    rt.status = "error";
    rt.lastError = msg;
    log(rt, "error", msg);
    await setDbStatus(record.id, "error", msg);
    return;
  }

  // Pre-fetch chat-signing certificates (best effort).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let profileKeys: any = null;
  try {
    profileKeys = await fetchProfileKeys(record.token);
    log(rt, "system", "Fetched chat-signing certificates.");
  } catch {
    log(
      rt,
      "system",
      "Could not fetch chat certificates (continuing without chat signing).",
    );
  }

  const usePinnedVersion =
    record.version && record.version !== "auto" ? record.version : false;

  // Optional SOCKS proxy support.
  const proxyConf = parseProxy(record.proxy);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let connectFn: ((client: any) => void) | undefined;
  if (proxyConf) {
    let SocksClient: typeof import("socks").SocksClient;
    try {
      ({ SocksClient } = await import("socks"));
    } catch (err) {
      const msg =
        "Proxy requested but 'socks' failed to load: " +
        (err instanceof Error ? err.message : String(err));
      rt.status = "error";
      rt.lastError = msg;
      log(rt, "error", msg);
      await setDbStatus(record.id, "error", msg);
      return;
    }
    log(
      rt,
      "system",
      `Routing through SOCKS${proxyConf.type} proxy ${proxyConf.host}:${proxyConf.port} ...`,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connectFn = (client: any) => {
      SocksClient.createConnection(
        {
          proxy: {
            host: proxyConf.host,
            port: proxyConf.port,
            type: proxyConf.type,
            userId: proxyConf.userId,
            password: proxyConf.password,
          },
          command: "connect",
          destination: { host: record.host, port: record.port },
          timeout: 20000,
        },
        (err, info) => {
          if (err || !info) {
            const m = "Proxy connection failed: " + (err?.message || "unknown");
            rt.lastError = m;
            log(rt, "error", m);
            client.emit("error", err || new Error("proxy connect failed"));
            return;
          }
          client.setSocket(info.socket);
          client.emit("connect");
        },
      );
    };
  }

  try {
    const bot = mineflayer.createBot({
      host: record.host,
      port: record.port,
      username: profile.name,
      version: usePinnedVersion,
      hideErrors: true,
      // Present a realistic vanilla client fingerprint to reduce anticheat
      // flags on normal servers. (Note: this cannot defeat hardened paid
      // anticheats that fingerprint behaviour, e.g. mcpvp.)
      brand: "vanilla",
      viewDistance: "far",
      chatLengthLimit: 256,
      checkTimeoutInterval: 60 * 1000,
      keepAlive: false, // We handle NMP keep_alive manually to spoof vanilla ping
      ...(connectFn ? { connect: connectFn } : {}),
      // Custom auth: inject the bearer token session + certificates ourselves.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      auth: (client: any, options: any) => {
        client.session = {
          accessToken: record.token,
          selectedProfile: { id: profile.id, name: profile.name },
          availableProfiles: [{ id: profile.id, name: profile.name }],
        };
        client.username = profile.name;
        options.accessToken = record.token;
        options.haveCredentials = true;
        if (profileKeys) client.profileKeys = profileKeys;
        // Respect a custom proxy connect function if present.
        if (connectFn) options.connect = connectFn;
        client.emit("session", client.session);
        options.connect(client);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    rt.bot = bot;

    const timeout = setTimeout(() => {
      if (!rt.joined && rt.status === "connecting") {
        const msg = "Connection timed out (server did not respond in 45s).";
        rt.status = "error";
        rt.lastError = msg;
        log(rt, "error", msg);
        void setDbStatus(record.id, "error", msg);
        try {
          bot.quit();
        } catch {
          // ignore
        }
      }
    }, 45000);

    bot.once("login", () => {
      log(rt, "system", "Logged in to the server.");
      
      // 1. Raw NMP Vanilla Keep-Alive Spoofing
      // Real clients take network ping time to respond to keep_alives. Mineflayer
      // responds in 0ms by default, which is a massive red flag to anticheats.
      // We simulate a 35ms - 85ms ping latency.
      if (bot._client) {
        bot._client.on("keep_alive", (packet: any) => {
          setTimeout(() => {
            if (bot._client?.state === "play") {
              try {
                bot._client.write("keep_alive", {
                  keepAliveId: packet.keepAliveId,
                });
              } catch {
                // ignore
              }
            }
          }, 35 + Math.random() * 50);
        });
      }
    });

    bot.once("spawn", () => {
      clearTimeout(timeout);
      rt.joined = true;
      rt.status = "online";
      rt.lastError = null;
      const v = bot.version ? ` (protocol ${bot.version})` : "";
      log(
        rt,
        "system",
        `✅ Joined ${record.host}:${record.port} successfully${v}.`,
      );
      void setDbStatus(record.id, "online");

      // Heavily tweak Mineflayer physics: completely disable automated movement.
      // This stops the robotic 20Hz 'position'/'position_look' packet spam that
      // strict anticheats easily fingerprint.
      bot.physicsEnabled = false;

      // Start the identical raw NMP stealth Anti-AFK loop
      let lastAction = 0;
      const actions = [
        () => { try { bot._client.write("entity_action", { entityId: 0, actionId: 0, jumpBoost: 0 }); setTimeout(() => { try { bot._client.write("entity_action", { entityId: 0, actionId: 1, jumpBoost: 0 }); } catch {} }, 300); } catch {} }, // sneak
        () => { try { bot._client.write("entity_action", { entityId: 0, actionId: 4, jumpBoost: 0 }); setTimeout(() => { try { bot._client.write("entity_action", { entityId: 0, actionId: 5, jumpBoost: 0 }); } catch {} }, 200); } catch {} }, // start/stop jumping
      ];

      const antiAfk = setInterval(() => {
        try {
          if (rt.status !== "online") { clearInterval(antiAfk); return; }
          const action = actions[lastAction % actions.length];
          action();
          lastAction++;
        } catch { clearInterval(antiAfk); }
      }, 15000 + Math.random() * 15000); // 15-30s random interval

      // Clean up the loop when disconnected
      bot.once("end", () => clearInterval(antiAfk));

      // Send a vanilla-style client settings packet and brand so the server
      // sees the same data a real Java client reports.
      try {
        // Tell the server our "vanilla" brand via the standard plugin channel.
        const brandBuf = Buffer.concat([
          Buffer.from([7]), // length-prefix for "vanilla" (varint, < 128)
          Buffer.from("vanilla", "utf8"),
        ]);
        if (typeof bot._client?.write === "function") {
          // Newer protocol uses "minecraft:brand", older uses "MC|Brand".
          try {
            bot._client.write("custom_payload", {
              channel: "minecraft:brand",
              data: brandBuf,
            });
          } catch {
            try {
              bot._client.write("custom_payload", {
                channel: "MC|Brand",
                data: brandBuf,
              });
            } catch {
              // ignore
            }
          }
        }
        // Vanilla default client settings.
        bot.setSettings({
          chat: "enabled",
          colorsEnabled: true,
          viewDistance: "far",
          skinParts: {
            showCape: true,
            showJacket: true,
            showLeftSleeve: true,
            showRightSleeve: true,
            showLeftPants: true,
            showRightPants: true,
            showHat: true,
          },
          mainHand: "right",
        });
      } catch {
        // settings packet best-effort
      }

      // Start subtle human-like idle behaviour so the bot isn't perfectly
      // static (real players constantly make tiny head movements / shifts).
      startHumanizer(rt);
    });

    // Plain-text chat / system messages from the server.
    bot.on("messagestr", (message: string) => {
      log(rt, "chat", message);
    });

    bot.on("kicked", (reason: unknown) => {
      clearTimeout(timeout);
      const reasonText = kickReasonToText(reason);
      const msg = "Kicked: " + reasonText;
      rt.status = "error";
      rt.lastError = msg;
      rt.joined = false;
      log(rt, "error", msg);
      if (/already logged (on|in)/i.test(reasonText)) {
        const hint =
          "That account still has a live session on the server (old sessions linger ~1 min after a stop/kick). Stop every other bot using this token, wait ~60s, then start again.";
        rt.lastError += " " + hint;
        log(rt, "system", hint);
      }
      void setDbStatus(record.id, "error", msg);
    });

    bot.on("error", (err: Error) => {
      clearTimeout(timeout);
      const msg = err?.message || String(err);
      if (!rt.manualStop) {
        rt.status = "error";
        rt.lastError = msg;
        log(rt, "error", msg);
        void setDbStatus(record.id, "error", msg);
      }
    });

    bot.on("end", (reason: string) => {
      clearTimeout(timeout);
      stopHumanizer(rt);
      rt.joined = false;
      rt.bot = null;
      if (rt.manualStop) {
        rt.status = "offline";
        log(rt, "system", "Bot stopped.");
        void setDbStatus(record.id, "offline");
      } else if (rt.status !== "error") {
        const wasConnecting = !rt.joined;
        rt.status = wasConnecting ? "error" : "offline";
        const reasonText = reason ?? "connection ended";
        log(rt, wasConnecting ? "error" : "system", `Disconnected: ${reasonText}`);
        // socketClosed before ever joining almost always = protocol/version
        // mismatch through the server's proxy (e.g. 1.8 practice servers).
        if (
          wasConnecting &&
          String(reasonText).toLowerCase().includes("socketclosed")
        ) {
          const hint =
            usePinnedVersion === false
              ? "Hint: auto-detect failed. Re-create this bot and pin the exact server version. PvP/practice networks (minemen, etc.) are usually 1.8.9."
              : `Hint: version ${usePinnedVersion} was refused. Try a different version that matches the server.`;
          rt.lastError = `Disconnected: ${reasonText}. ${hint}`;
          log(rt, "system", hint);
        } else if (wasConnecting) {
          rt.lastError = `Disconnected: ${reasonText}`;
        }
        void setDbStatus(record.id, rt.status, rt.lastError);
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    rt.status = "error";
    rt.lastError = msg;
    log(rt, "error", msg);
    await setDbStatus(record.id, "error", msg);
  }
}

export async function stopBot(id: string): Promise<void> {
  const rt = getOrCreateRuntime(id);
  rt.manualStop = true;
  rt.beamLoop = false;
  stopHumanizer(rt);
  if (rt.bot) {
    log(rt, "system", "Stopping bot...");
    try {
      // Force kill the TCP socket if it's a raw NMP client.
      if (rt.bot.socket && typeof rt.bot.socket.destroy === "function") {
        rt.bot.socket.destroy();
      }
      if (typeof rt.bot.quit === "function") rt.bot.quit();
      else if (typeof rt.bot.end === "function") rt.bot.end("Stopped");
      rt.bot.removeAllListeners();
    } catch {
      // ignore
    }
    rt.bot = null;
  }
  if (rt.azaleaChild) {
    try {
      rt.azaleaChild.kill("SIGTERM");
    } catch {
      // ignore
    }
    rt.azaleaChild = null;
  }
  rt.azaleaSnap = null;
  rt.status = "offline";
  rt.joined = false;
  await setDbStatus(id, "offline");
}

export function sendChat(id: string, message: string): boolean {
  const rt = runtimes.get(id);
  if (!rt || !rt.bot || rt.status !== "online") return false;
  try {
    if (typeof rt.bot.chat === "function") {
      rt.bot.chat(message);
    }
    // Accurate logging: detect /msg /w /tell to log as <you → target>
    const msgMatch = message.match(/^\/(msg|w|tell|whisper)\s+([A-Za-z0-9_]{3,16})\s+(.+)$/i);
    if (msgMatch) {
      const target = msgMatch[2];
      const content = msgMatch[3];
      log(rt, "chat", `<you → ${target}> ${content}`);
    } else {
      log(rt, "chat", `<you> ${message}`);
    }
    return true;
  } catch (err) {
    log(rt, "error", "Failed to send chat: " + (err instanceof Error ? err.message : String(err)));
    return false;
  }
}

export type ViewEntity = {
  name: string;
  type: string;
  kind: "player" | "mob" | "object" | "other";
  // Position relative to bot, rotated so +Z is where the bot faces.
  forward: number;
  right: number;
  dy: number;
  distance: number;
  // Absolute angle (radians) relative to bot's facing (0 = straight ahead).
  bearing: number;
};

export type HotbarItem = {
  slot: number; // 0-8
  name: string | null; // e.g. "cooked_beef"
  displayName: string | null; // e.g. "Steak"
  count: number;
  selected: boolean;
};

export type ViewSnapshot = {
  available: boolean;
  username: string;
  position: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  facing: string;
  health: number;
  food: number;
  dimension: string;
  timeOfDay: number;
  isDay: boolean;
  heldItem: string | null;
  lookingAt: { name: string; x: number; y: number; z: number } | null;
  entities: ViewEntity[];
  nearbyBlocks: { name: string; forward: number; right: number; dy: number }[];
  hotbar: HotbarItem[];
  selectedSlot: number;
  using: boolean;
  window: {
    title: string;
    slots: (HotbarItem | null)[];
  } | null;
};

function cardinal(yaw: number): string {
  // mineflayer yaw: 0 = south(+z), increases counter-clockwise
  const deg = ((yaw * 180) / Math.PI + 360) % 360;
  const dirs = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];
  return dirs[Math.round(deg / 45) % 8];
}

// Extract formatted text from Minecraft chat JSON components (for Raw NMP)
function extractText(obj: any): string {
  if (typeof obj === "string") return obj;
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
  if (!obj || typeof obj !== "object") return "";
  // Top-level arrays of components
  if (Array.isArray(obj)) return obj.map((e: any) => extractText(e)).join("");
  let r = "";
  if (typeof obj.text === "string") r += obj.text;
  if (typeof obj.translate === "string") {
    if (Array.isArray(obj.with)) r += obj.with.map((w: any) => extractText(w)).join(" ");
    else r += obj.translate;
  }
  if (Array.isArray(obj.extra)) r += obj.extra.map((e: any) => extractText(e)).join("");
  return r;
}

// Turns any Minecraft kick/disconnect reason (stringified JSON component,
// already-parsed component object, or plain string) into readable text.
function kickReasonToText(reason: unknown): string {
  let text = "";
  try {
    if (typeof reason === "string") {
      // Mineflayer usually hands us a JSON string of a chat component.
      try {
        text = extractText(JSON.parse(reason));
      } catch {
        text = reason; // plain string
      }
    } else if (reason && typeof reason === "object") {
      text = extractText(reason);
      if (!text.trim()) text = JSON.stringify(reason);
    } else {
      text = String(reason ?? "");
    }
  } catch {
    try {
      text = JSON.stringify(reason);
    } catch {
      text = String(reason);
    }
  }
  // Collapse stray newlines for logging & strip legacy color codes.
  text = text.replace(/\r/g, "").trim();
  text = text.replace(/\u00A7./g, "");
  return text;
}

// Robustly extracts a sender and their message from various Minecraft chat string formats.
// Supports generic Vanilla chat, Minemen/MCPVP ranks, and direct messages.
function extractSenderAndMessage(raw: string): { sender: string; msg: string } | null {
  const clean = raw.replace(/\u00A7./g, "").trim();

  // 1. <Player> Message
  let m = clean.match(/^<([A-Za-z0-9_]+)>\s+(.+)$/);
  if (m) return { sender: m[1], msg: m[2] };

  // 2. [Rank] Player » Message OR Player » Message
  m = clean.match(/(?:\]\s*)?([A-Za-z0-9_]+)\s*[»>]\s+(.+)$/);
  if (m) return { sender: m[1], msg: m[2] };

  // 3. [Rank] Player: Message OR Player: Message
  m = clean.match(/(?:\]\s*)?([A-Za-z0-9_]+)\s*:\s+(.+)$/);
  if (m) return { sender: m[1], msg: m[2] };

  // 4. From Player: Message OR Player whispers: Message
  m = clean.match(/^(?:From\s+)?([A-Za-z0-9_]+)\s*(?:whispers(?: to you)?:|:)\s+(.+)$/i);
  if (m) return { sender: m[1], msg: m[2] };

  return null;
}

export function getViewSnapshot(id: string): ViewSnapshot | null {
  const rt = runtimes.get(id);
  if (!rt || !rt.bot || rt.status !== "online") {
    return null;
  }

  if (rt.azaleaSnap) {
    return rt.azaleaSnap as ViewSnapshot;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bot: any = rt.bot;

  // Raw NMP Fallback: Return a valid but empty snapshot so UI renders buttons
  if (!bot.entity) {
    return {
      available: true,
      username: bot.username ?? "bot",
      position: { x: 0, y: 0, z: 0 },
      yaw: 0,
      pitch: 0,
      facing: "N",
      health: 20,
      food: 20,
      dimension: "overworld",
      timeOfDay: 0,
      isDay: true,
      heldItem: null,
      lookingAt: null,
      entities: [],
      nearbyBlocks: [],
      hotbar: Array.from({ length: 9 }).map((_, i) => ({
        slot: i,
        name: null,
        displayName: null,
        count: 0,
        selected: i === 0,
      })),
      selectedSlot: 0,
      using: rt.using === true,
      window: null,
    };
  }

  const pos = bot.entity.position;
  const yaw = bot.entity.yaw ?? 0;
  const pitch = bot.entity.pitch ?? 0;

  // Build a rotation so "forward" aligns with the direction the bot faces.
  // Bot forward vector: x = -sin(yaw), z = cos(yaw) (Minecraft convention).
  const fx = -Math.sin(yaw);
  const fz = Math.cos(yaw);
  // Right vector (perpendicular, to the bot's right).
  const rx = -Math.cos(yaw);
  const rz = -Math.sin(yaw);

  const entities: ViewEntity[] = [];
  try {
    for (const key of Object.keys(bot.entities)) {
      const e = bot.entities[key];
      if (!e || e === bot.entity || !e.position) continue;
      const dx = e.position.x - pos.x;
      const dz = e.position.z - pos.z;
      const dy = e.position.y - pos.y;
      const distance = Math.sqrt(dx * dx + dz * dz + dy * dy);
      if (distance > 64) continue;
      const forward = dx * fx + dz * fz;
      const right = dx * rx + dz * rz;
      const bearing = Math.atan2(right, forward);
      let kind: ViewEntity["kind"] = "other";
      if (e.type === "player") kind = "player";
      else if (e.type === "mob" || e.type === "animal" || e.type === "hostile")
        kind = "mob";
      else if (e.type === "object" || e.type === "orb") kind = "object";
      const name =
        e.username ||
        e.displayName ||
        (e.name ? String(e.name) : null) ||
        e.type ||
        "entity";
      entities.push({
        name: String(name),
        type: String(e.type ?? "unknown"),
        kind,
        forward: Math.round(forward * 10) / 10,
        right: Math.round(right * 10) / 10,
        dy: Math.round(dy * 10) / 10,
        distance: Math.round(distance * 10) / 10,
        bearing,
      });
    }
  } catch {
    // ignore entity read errors
  }
  entities.sort((a, b) => a.distance - b.distance);

  let lookingAt: ViewSnapshot["lookingAt"] = null;
  try {
    const block = bot.blockAtCursor ? bot.blockAtCursor(6) : null;
    if (block) {
      lookingAt = {
        name: block.name,
        x: block.position.x,
        y: block.position.y,
        z: block.position.z,
      };
    }
  } catch {
    // ignore
  }

  // Sample a small ring of nearby blocks at foot level for a minimap feel.
  const nearbyBlocks: ViewSnapshot["nearbyBlocks"] = [];
  try {
    const Vec3 = bot.entity.position.constructor;
    for (let ox = -6; ox <= 6; ox += 2) {
      for (let oz = -6; oz <= 6; oz += 2) {
        if (ox === 0 && oz === 0) continue;
        const bx = Math.floor(pos.x) + ox;
        const bz = Math.floor(pos.z) + oz;
        const by = Math.floor(pos.y) - 1;
        const b = bot.blockAt(new Vec3(bx, by, bz));
        if (b && b.name && b.name !== "air" && b.boundingBox !== "empty") {
          const dx = bx + 0.5 - pos.x;
          const dz = bz + 0.5 - pos.z;
          nearbyBlocks.push({
            name: b.name,
            forward: Math.round((dx * fx + dz * fz) * 10) / 10,
            right: Math.round((dx * rx + dz * rz) * 10) / 10,
            dy: -1,
          });
        }
      }
    }
  } catch {
    // ignore
  }

  let heldItem: string | null = null;
  try {
    heldItem = bot.heldItem ? bot.heldItem.displayName || bot.heldItem.name : null;
  } catch {
    // ignore
  }

  // Build the 9-slot hotbar. In Minecraft the hotbar maps to inventory
  // slots 36..44, and bot.quickBarSlot (0..8) is the currently selected slot.
  const selectedSlot = Number(bot.quickBarSlot ?? 0);
  const hotbar: HotbarItem[] = [];
  try {
    const slots = bot.inventory?.slots ?? [];
    for (let i = 0; i < 9; i++) {
      const item = slots[36 + i];
      hotbar.push({
        slot: i,
        name: item ? String(item.name) : null,
        displayName: item ? String(item.displayName ?? item.name) : null,
        count: item ? Number(item.count ?? 1) : 0,
        selected: i === selectedSlot,
      });
    }
  } catch {
    for (let i = 0; i < 9; i++) {
      hotbar.push({
        slot: i,
        name: null,
        displayName: null,
        count: 0,
        selected: i === selectedSlot,
      });
    }
  }

  let windowData = null;
  try {
    if (bot.currentWindow) {
      const w = bot.currentWindow;
      const title =
        typeof w.title === "string" ? w.title : JSON.stringify(w.title || "");
      const wSlots: (HotbarItem | null)[] = [];
      for (let i = 0; i < w.slots.length; i++) {
        const item = w.slots[i];
        if (item) {
          wSlots.push({
            slot: i,
            name: String(item.name),
            displayName: String(item.displayName ?? item.name),
            count: Number(item.count ?? 1),
            selected: false,
          });
        } else {
          wSlots.push(null);
        }
      }
      windowData = { title, slots: wSlots };
    }
  } catch {
    // ignore
  }

  const timeOfDay = bot.time ? Number(bot.time.timeOfDay ?? 0) : 0;

  return {
    available: true,
    username: bot.username ?? "bot",
    position: {
      x: Math.round(pos.x * 100) / 100,
      y: Math.round(pos.y * 100) / 100,
      z: Math.round(pos.z * 100) / 100,
    },
    yaw,
    pitch,
    facing: cardinal(yaw),
    health: Math.round((bot.health ?? 0) * 10) / 10,
    food: Math.round((bot.food ?? 0) * 10) / 10,
    dimension: String(bot.game?.dimension ?? "overworld"),
    timeOfDay,
    isDay: timeOfDay < 13000,
    heldItem,
    lookingAt,
    entities: entities.slice(0, 40),
    nearbyBlocks,
    hotbar,
    selectedSlot,
    using: rt.using === true,
    window: windowData,
  };
}

// ----- Bot actions: select hotbar slot, use/right-click, eat, drop -----

export type BotActionResult = { ok: boolean; message: string };

export async function selectHotbarSlot(
  id: string,
  slot: number,
): Promise<BotActionResult> {
  const rt = runtimes.get(id);
  if (!rt || !rt.bot || rt.status !== "online") {
    return { ok: false, message: "Bot is not online" };
  }
  if (slot < 0 || slot > 8) {
    return { ok: false, message: "Slot must be 0-8" };
  }
  try {
    if (typeof rt.bot.setQuickBarSlot === "function") {
      await rt.bot.setQuickBarSlot(slot);
      const held = rt.bot.heldItem;
      const label = held ? held.displayName || held.name : "empty hand";
      log(rt, "system", `Selected hotbar slot ${slot + 1} (${label}).`);
    } else {
      // Raw NMP implementation
      rt.bot.write("held_item_slot", { slotId: slot });
      log(rt, "system", `Selected hotbar slot ${slot + 1} (Raw NMP).`);
    }
    return { ok: true, message: `Selected slot ${slot + 1}` };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function useHeldItem(id: string): Promise<BotActionResult> {
  const rt = runtimes.get(id);
  if (!rt || !rt.bot || rt.status !== "online") {
    return { ok: false, message: "Bot is not online" };
  }

  // Raw NMP implementation fallback
  if (typeof rt.bot.activateItem !== "function") {
    try {
      rt.bot.write("use_item", { hand: 0, sequence: 0 });
      log(rt, "system", `Right-clicked (Raw NMP).`);
      return { ok: true, message: "Used item" };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  }

  const held = rt.bot.heldItem;
  if (!held) {
    return { ok: false, message: "Nothing in hand to use" };
  }
  try {
    // bot.consume() handles food/potions; fall back to activateItem otherwise.
    const name = String(held.name);
    const isConsumable =
      /(beef|porkchop|chicken|mutton|rabbit|cod|salmon|bread|apple|carrot|potato|beetroot|melon|berries|cookie|pie|stew|soup|honey|milk|potion|chorus|kelp|rotten|spider_eye|pufferfish|tropical)/i.test(
        name,
      );
    rt.using = true;
    if (isConsumable && typeof rt.bot.consume === "function") {
      log(rt, "system", `Eating/consuming ${held.displayName || name}...`);
      await rt.bot.consume();
      log(rt, "system", `Finished consuming ${held.displayName || name}.`);
    } else {
      log(rt, "system", `Right-click using ${held.displayName || name}...`);
      rt.bot.activateItem();
      // Hold for a moment then release (covers bow draw, shield, etc.)
      await new Promise((r) => setTimeout(r, 1600));
      try {
        rt.bot.deactivateItem();
      } catch {
        // ignore
      }
    }
    rt.using = false;
    return { ok: true, message: "Used item" };
  } catch (err) {
    rt.using = false;
    const msg = err instanceof Error ? err.message : String(err);
    log(rt, "error", `Use item failed: ${msg}`);
    return { ok: false, message: msg };
  }
}

export async function dropHeldItem(id: string): Promise<BotActionResult> {
  const rt = runtimes.get(id);
  if (!rt || !rt.bot || rt.status !== "online") {
    return { ok: false, message: "Bot is not online" };
  }
  const held = rt.bot.heldItem;
  if (!held) {
    return { ok: false, message: "Nothing in hand to drop" };
  }
  try {
    await rt.bot.tossStack(held);
    log(rt, "system", `Dropped ${held.displayName || held.name}.`);
    return { ok: true, message: "Dropped item" };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function moveBot(id: string, dir: string): Promise<BotActionResult> {
  const rt = runtimes.get(id);
  if (!rt || !rt.bot || rt.status !== "online") {
    return { ok: false, message: "Bot is not online" };
  }
  const bot = rt.bot;
  try {
    bot.setControlState(dir as any, true);
    setTimeout(() => {
      try {
        bot.setControlState(dir as any, false);
      } catch {}
    }, 600);
    return { ok: true, message: `Moved ${dir}` };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

export async function clickWindowSlot(id: string, slot: number): Promise<BotActionResult> {
  const rt = runtimes.get(id);
  if (!rt || !rt.bot || rt.status !== "online") {
    return { ok: false, message: "Bot is not online" };
  }
  const bot = rt.bot;
  try {
    if (!bot.currentWindow) {
      return { ok: false, message: "No window open" };
    }
    await bot.clickWindow(slot, 0, 0);
    log(rt, "system", `Clicked slot ${slot} in window.`);
    return { ok: true, message: `Clicked slot ${slot}` };
  } catch (err) {
    log(rt, "error", `Failed to click slot: ${err}`);
    return { ok: false, message: String(err) };
  }
}

export async function closeWindow(id: string): Promise<BotActionResult> {
  const rt = runtimes.get(id);
  if (!rt || !rt.bot || rt.status !== "online") {
    return { ok: false, message: "Bot is not online" };
  }
  const bot = rt.bot;
  try {
    if (bot.currentWindow) {
      bot.closeWindow(bot.currentWindow);
      log(rt, "system", `Closed window.`);
    }
    return { ok: true, message: "Window closed" };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

// ----------------- BEAM: scripted recruit + conversational AI ----------------

export function getBeamState(id: string): {
  beaming: boolean;
  looping: boolean;
  stage: string;
} {
  const rt = runtimes.get(id);
  if (!rt) return { beaming: false, looping: false, stage: "" };
  return { beaming: rt.beaming, looping: rt.beamLoop, stage: rt.beamStage };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A valid Minecraft username: 3-16 chars, letters/digits/underscore only.
// This rejects color-code junk like "§r" that would get us kicked for
// "Illegal characters in chat".
function isValidUsername(name: unknown): name is string {
  return typeof name === "string" && /^[A-Za-z0-9_]{3,16}$/.test(name);
}

// Strip Minecraft formatting/color codes and trim.
function cleanName(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\u00A7./g, "")
    .replace(/[^A-Za-z0-9_]/g, "")
    .trim();
}

// Find the nearest other player. Returns a VALID username or null.
function findNearestPlayer(rt: BotRuntime, selfName: string): string | null {
  const bot = rt.bot;
  if (!bot) return null;

  // Mineflayer implementation – try nearest entity first
  if (typeof bot.nearestEntity === "function") {
    try {
      const entity = bot.nearestEntity(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) =>
          e.type === "player" &&
          e !== bot.entity &&
          isValidUsername(e.username) &&
          e.username.toLowerCase() !== selfName.toLowerCase(),
      );
      if (entity && isValidUsername(entity.username)) {
        return String(entity.username);
      }
    } catch {
      // ignore
    }
    // Fallback: scan the players map for the closest VALID-named player.
    try {
      const me = bot.entity?.position;
      let best: string | null = null;
      let bestDist = Infinity;
      for (const name of Object.keys(bot.players || {})) {
        if (!isValidUsername(name)) continue;
        if (name.toLowerCase() === selfName.toLowerCase()) continue;
        const p = bot.players[name];
        const ent = p?.entity;
        if (ent?.position && me) {
          const d = ent.position.distanceTo(me);
          if (d < bestDist) {
            bestDist = d;
            best = name;
          }
        } else if (!best) {
          best = name;
        }
      }
      if (best) return best;
    } catch {
      // ignore
    }
  }

  // Azalea & Raw NMP fallback – use nmpPlayers set (populated from player_add events)
  // This is critical for Azalea where nearestEntity returns null and players map may be incomplete after arena switch
  if (rt.nmpPlayers && rt.nmpPlayers.size > 0) {
    const players = Array.from(rt.nmpPlayers).filter(
      (n) => n.toLowerCase() !== selfName.toLowerCase() && isValidUsername(n),
    );
    if (players.length > 0) {
      // Prefer the most recently added player (last in set) as it's likely the opponent in duel
      // For duel matches, opponent is usually the last player added after match start
      return players[players.length - 1];
    }
  }

  // Final fallback: check bot.players even for Azalea (in case nmpPlayers empty)
  try {
    const playerNames = Object.keys(bot.players || {}).filter(
      (n) => isValidUsername(n) && n.toLowerCase() !== selfName.toLowerCase(),
    );
    if (playerNames.length > 0) {
      return playerNames[playerNames.length - 1];
    }
  } catch {
    // ignore
  }

  return null;
}

type BeamIntent = "positive" | "negative" | "question" | "neutral";
type AiTurn = { intent: BeamIntent; reply: string };

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Strictly detect a whisper FROM a specific player (not chat/kill messages).
// Supports common formats: "(From X) msg", "From X: msg", "X whispers: msg",
// "X -> me: msg".
function parseWhisperFrom(line: string, target: string): string | null {
  const t = escapeRegex(target);
  const clean = line.replace(/\u00A7./g, "").trim();
  const patterns: RegExp[] = [
    new RegExp(`\\(from\\s+(?:\\[[^\\]]+\\]\\s*)?${t}\\)\\s*:?\\s*(.+)`, "i"),
    new RegExp(`^\\s*from\\s+(?:\\[[^\\]]+\\]\\s*)?${t}\\s*:?\\s*(.+)`, "i"),
    new RegExp(`^\\s*(?:\\[[^\\]]+\\]\\s*)?${t}\\s+whispers(?:\\s+to\\s+you)?\\s*:?\\s*(.+)`, "i"),
    new RegExp(`^\\s*(?:\\[[^\\]]+\\]\\s*)?${t}\\s*(?:->|\u2192|\u00BB|>)\\s*(?:me|you)\\s*:?\\s*(.+)`, "i"),
    new RegExp(`\\bfrom\\b[^:]*\\b${t}\\b[^:]*:\\s*(.+)`, "i"),
    new RegExp(`\\bfrom\\s+${t}\\b\\s*[:\uFF1A]\\s*(.+)`, "i"),
    new RegExp(`^\\s*\\[W\\]\\s*${t}\\s*:\\s*(.+)`, "i"),
  ];
  for (const re of patterns) {
    const m = clean.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function parsePublicChatFrom(line: string, target: string): string | null {
  const t = escapeRegex(target);
  const clean = line.replace(/\u00A7./g, "").trim();
  const patterns: RegExp[] = [
    new RegExp(`(?:^|[^a-zA-Z0-9_])${t}\\b[^:\u00BB>\u2192]*:\\s*(.+)$`, "i"),
    new RegExp(`(?:^|[^a-zA-Z0-9_])${t}\\b[^:\u00BB>\u2192]*[\u00BB>\u2192]\\s*(.+)$`, "i"),
    new RegExp(`\\b${t}\\b.*?[»:\u00BB>\u2192:]\\s*(.+)$`, "i"),
  ];
  for (const re of patterns) {
    const m = clean.match(re);
    if (m && m[1]) {
      const msg = m[1].trim();
      if (!msg) continue;
      if (/^(?:map|ping|opponent|winner|loser|searching|casual|ranked)/i.test(msg)) continue;
      if (msg.length > 0 && msg.length <= 256) return msg;
    }
  }
  return null;
}

function parseAnyChatFrom(line: string, target: string): string | null {
  const clean = line.replace(/\u00A7./g, "").trim();
  const low = clean.toLowerCase();
  const tLow = target.toLowerCase();
  if (!low.includes(tLow)) return null;
  if (low.includes("opponent:") || low.includes("map:") || low.includes("ping:") || low.includes("winner:") || low.includes("loser:")) return null;
  const idx = low.indexOf(tLow);
  const after = clean.slice(idx + target.length).trim();
  const sepMatch = after.match(/^[^A-Za-z0-9_]*[»:\u00BB>\u2192]\s*(.+)$/) || after.match(/^[^A-Za-z0-9_]*:\s*(.+)$/);
  if (sepMatch && sepMatch[1]) {
    const msg = sepMatch[1].trim();
    if (msg && msg.length >= 1 && msg.length <= 256) return msg;
  }
  return null;
}

// Conversational AI via OpenRouter API. Returns intent + an in-character reply.
async function aiConverse(
  channel: string,
  selfName: string,
  history: { who: "me" | "them"; text: string }[],
  latest: string,
  serverIp = "badlion-pvp.xyz",
  discordUser = "stood014",
): Promise<AiTurn> {
  const openRouterKey = process.env.OPENROUTER_API_KEY || "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";
  const model = process.env.OPENROUTER_MODEL || "poolside/laguna-xs-2.1:free";

  // Pull learned guidelines if AI training is enabled.
  let learnings = "";
  try {
    const { getTrainingState } = await import("@/lib/training");
    const t = await getTrainingState();
    if (t.training && t.learnings) learnings = t.learnings;
  } catch {
    // ignore
  }

  const convo = history
    .map((h) => `${h.who === "me" ? "me" : "them"}: ${h.text}`)
    .join("\n");

  const safeIp = serverIp.replace(/\./g, " [dot] ");

  const systemPrompt =
    `You are a real Minecraft player named ${selfName} chatting with another player. ` +
    `You're recruiting them for a video. Win = both rank up.\n\n` +
    `CRITICAL RULES FOR REPLIES (DO NOT BREAK THESE):\n` +
    `- EXTREMELY SHORT. Maximum 10 words per reply. ONE single thought per reply. NEVER info-dump. Don't yap.\n` +
    `- Chill, lowercase, no punctuation, typos ok. Be persuasive but play it cool.\n` +
    `- YOU ARE ALREADY IN-GAME CHATTING WITH THEM. Do not ask for their IGN.\n` +
    `- NEVER mention your youtube channel name ("${channel}") UNLESS they explicitly ask "whats your channel".\n` +
    `- DO NOT keep repeating "2v2" or "youtube". Just say "team up" or "u down". Act normal.\n` +
    `- DO NOT give your discord (${discordUser}) unless they say yes/agree or ask for it.\n` +
    `- IF THEY SAY they sent the discord friend request ("sent", "added", "done"), reply with something like "alright one sec please" or "checking rn"\n` +
    `- NEVER GIVE THE SERVER IP UNLESS THEY EXPLICITLY REFUSE DISCORD. Wait for them to say "i cant use discord" before dropping the IP.\n` +
    `- ALWAYS format the IP exactly as "${safeIp}". NEVER use a real dot or you will get banned.\n` +
    `- IF THEY ASK "is it on this server?" or "here?", say exactly: "nope its on a public server"\n` +
    `- IF THEY SAY "im gd", "im good", "nah", "gd", "nah im gd", THEY ARE REJECTING YOU. Output 'negative' intent.\n\n` +
    (learnings
      ? `LEARNED GUIDELINES (follow these):\n${learnings}\n\n`
      : "") +
    `Decide the intent of their LATEST message and write your next reply.\n` +
    `Output ONLY strict minified JSON: {"intent":"positive|negative|question|neutral","reply":"<your under-10-words reply>"}.\n` +
    `INTENT MEANINGS:\n` +
    `- positive = they agree to team up\n` +
    `- negative = they refuse, say "im gd", "nah", insult you\n` +
    `- question = asking when, what gamemode, what channel, this server, etc.\n` +
    `- neutral = off-topic or unclear\n\n`;

  const userPrompt = (convo ? `conversation so far:\n${convo}\n\n` : "") + `their latest message: ${latest}`;

  try {
    const url = "https://openrouter.ai/api/v1/chat/completions";
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openRouterKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 150,
      }),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (res.ok) {
      const jsonRes = await res.json();
      const raw = jsonRes.choices?.[0]?.message?.content || "";
      
      // Since DeepSeek-R1 outputs thought processes in <think> tags, we need to strip them.
      const cleanRaw = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

      const jsonMatch = cleanRaw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const obj = JSON.parse(jsonMatch[0]);
          const intent = String(obj.intent || "").toLowerCase();
          const reply = String(obj.reply || "").slice(0, 120);
          if (
            intent === "positive" ||
            intent === "negative" ||
            intent === "question" ||
            intent === "neutral"
          ) {
            return { intent: intent as BeamIntent, reply };
          }
        } catch {
          // fall through
        }
      }
      
      // No JSON — try to infer intent from text.
      const low = cleanRaw.toLowerCase();
      if (low.includes("positive")) return { intent: "positive", reply: "" };
      if (low.includes("negative")) return { intent: "negative", reply: "" };
      if (low.includes("question")) return { intent: "question", reply: cleanRaw };
    } else {
      console.error("OpenRouter API Error:", res.status, await res.text());
    }
  } catch (err) {
    console.error("OpenRouter API Exception:", err);
    // fall through to heuristic
  }

  // Heuristic fallback.
  const t = latest.toLowerCase();
  if (/\b(channel|chanel|yt|youtube|name|what.?s it called)\b/.test(t)) {
    return { intent: "question", reply: `its ${channel}` };
  }
  if (
    /\b(yes|yea|yeah|yep|sure|ok|okay|kk|alr|alright|down|lets|let's|bet|fs|for sure|ofc|aight|ight|yessir|why not|i can|i'?ll help|help)\b/.test(
      t,
    )
  ) {
    return { intent: "positive", reply: "lets go" };
  }
  if (
    /\b(no|nah|nope|cant|can'?t|busy|stop|leave|go away|stfu|noob|cringe|scam|bot|never|nty|idc|annoying)\b/.test(
      t,
    )
  ) {
    return { intent: "negative", reply: "" };
  }
  return { intent: "neutral", reply: "" };
}

// Run ONE recruit attempt against the nearest player. Returns an outcome.
async function runBeamOnce(
  rt: BotRuntime,
  record: Bot,
): Promise<"positive" | "negative" | "died" | "noplayer" | "stopped"> {
  const channel = record.ytChannel;
  const serverIp = record.beamIp;
  const discordUser = record.discordUser;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bot: any = rt.bot;
  const self = String(bot.username || "bot");
  const SEND_GAP = 2600;

  if (record.beamType === "spam") {
    rt.beamStage = "spamming";
    const msg = record.spamMessage;
    try {
      bot.chat(msg);
      log(rt, "chat", `<you → server> ${msg}`);
      
      // Also save to training DB as a "spam" log
      try {
        const { recordConversation } = await import("@/lib/training");
        void recordConversation({
          botId: rt.id,
          target: "spam",
          outcome: "positive",
          transcript: [{ who: "me", text: msg }],
        });
      } catch {}
    } catch {
      // ignore
    }
    
    // Now wait for the specified interval, BUT during this time listen for the trigger word.
    const interval = Number(record.spamInterval) > 0 ? Number(record.spamInterval) : 60000;
    const triggerWord = record.spamTriggerWord.toLowerCase();
    const replyMsg = record.spamReplyMessage;

    const onChat = (message: any) => {
      // Basic implementation: wait for trigger word from ANY player, then /msg them the reply.
      const raw = typeof message === "string" ? message : String(message);
      const low = raw.toLowerCase();
      
      // Don't reply to self.
      if (low.includes(`<${self.toLowerCase()}>`)) return;
      if (low.includes(self.toLowerCase()) && low.includes("->")) return; // sent whispers
      
      if (low.includes(triggerWord)) {
        const parsed = extractSenderAndMessage(raw);
        if (parsed) {
          const sender = parsed.sender;
          if (sender.toLowerCase() !== self.toLowerCase() && isValidUsername(sender)) {
            try {
              bot.chat(`/msg ${sender} ${replyMsg}`);
              log(rt, "chat", `<you → ${sender}> ${replyMsg}`);
            
              // Also log the trigger interaction
              try {
                import("@/lib/training").then(m => {
                  m.recordConversation({
                    botId: rt.id,
                    target: sender,
                    outcome: "positive",
                    transcript: [
                      { who: "them", text: raw },
                      { who: "me", text: replyMsg }
                    ],
                  });
                });
              } catch {}
            } catch {}
          }
        }
      }
    };
    bot.on("messagestr", onChat);
    
    // Wait for the interval in chunks to allow stopping
    const start = Date.now();
    while (Date.now() - start < interval) {
      if (!rt.beamLoop) {
        bot.removeListener("messagestr", onChat);
        return "stopped";
      }
      await sleep(1000);
    }
    bot.removeListener("messagestr", onChat);
    return "positive"; // Loop again
  }

  // 1) Auto-queue for MCPVP or use hotbar right-click
  if (record.host.toLowerCase().includes("mcpvp")) {
    const queues = ["/queue sword", "/queue mace", "/queue axe"];
    const q = queues[Math.floor(Math.random() * queues.length)];
    rt.beamStage = "auto queue (MCPVP)";
    try {
      bot.chat(q);
      log(rt, "chat", `<you → server> ${q}`);
      log(rt, "system", `🔆 Beam: Sent ${q} to auto-join match.`);
    } catch {}
    await sleep(1500);
  } else {
    // Hold hotbar slot 3 + right-click.
    rt.beamStage = "equipping (slot 3 + right click)";
    log(rt, "system", "🔆 Beam: slot 3 + right-click.");
    try {
      await bot.setQuickBarSlot(2);
    } catch {
      // ignore
    }
    await sleep(300);
    try {
      bot.activateItem();
      await sleep(600);
      bot.deactivateItem();
    } catch {
      // ignore
    }
  }

  if (!rt.beamLoop) return "stopped";

  // Wait for the server's "Match started!" message, OR fallback to a simple timeout if it doesn't appear.
  // This solves the issue where opponents are vanished during the "5... 4... 3..." countdown.
  rt.beamStage = "waiting for match to start";
  log(rt, "system", "🔆 Beam: waiting for match start...");
  let matchStarted = false;
  let opponentFromChat: string | null = null;
  const matchStartListener = (msg: any) => {
    // Strip color codes AND zero-width spaces/invisible characters and common symbols like ●
    const rawTxt = String(msg);
    const txt = rawTxt.replace(/[\u00A7\u200B-\u200D\uFEFF●•]/g, " ").replace(/\s+/g, " ").trim();
    const low = txt.toLowerCase();
    if (low.includes("match started") || low.includes("duel started") || low.includes("fight started") || low.includes("game started")) matchStarted = true;
    if (low.includes("vs ") || low.includes("versus") || low.includes("fighting") || low.includes("dueling")) {
      // Some servers show "You vs PLAYER" or "Fighting PLAYER"
      const vsMatch = txt.match(/(?:vs\.?|versus|fighting|dueling|against)\s+(?:\[[^\]]+\]\s*)?([A-Za-z0-9_]{3,16})/i);
      if (vsMatch && vsMatch[1] && isValidUsername(vsMatch[1]) && vsMatch[1].toLowerCase() !== self.toLowerCase()) {
        opponentFromChat = vsMatch[1].trim();
        log(rt, "system", `🔆 Beam: Chat extracted target (vs) → ${opponentFromChat}`);
      }
    }
    // Listen for the exact opponent name in the queue text
    // The chat often has bullets (●) or other symbols before it.
    // More robust: if line contains "Opponent", extract all valid usernames and pick last valid one
    if (low.includes("opponent")) {
      // First try original regex
      const oppMatch = txt.match(/Opponent[^A-Za-z0-9_]*([A-Za-z0-9_]{3,16})/i);
      if (oppMatch && oppMatch[1] && isValidUsername(oppMatch[1]) && oppMatch[1].toLowerCase() !== self.toLowerCase()) {
        opponentFromChat = oppMatch[1].trim();
        log(rt, "system", `🔆 Beam: Chat extracted target → ${opponentFromChat}`);
      } else {
        // Fallback: extract all usernames from line and pick last valid that isn't self
        const allNames = txt.match(/[A-Za-z0-9_]{3,16}/g) || [];
        // Filter out common words like Opponent, Map, Ping, etc.
        const filtered = allNames.filter(n => {
          const l = n.toLowerCase();
          if (["opponent","map","ping","searching","match","casual","ranked","meadows","crystal","winner","loser"].includes(l)) return false;
          return isValidUsername(n) && l !== self.toLowerCase();
        });
        if (filtered.length > 0) {
          opponentFromChat = filtered[filtered.length - 1];
          log(rt, "system", `🔆 Beam: Chat extracted target (fallback) → ${opponentFromChat} from \"${txt.slice(0,80)}\"`);
        }
      }
    }
    // Also handle Minemen style: "Opponent: Fran1oPL" might be split – if we see a username after opponent line, capture
    // If txt looks like just a username and previous line had Opponent, we already handled via fallback
  };
  
  // On MCPVP, there is no "Match started!" message. Instead, the server
  // transfers you to a duel instance, which fires a 'login' or 'respawn' packet.
  // FIX: Only MCPVP uses BungeeCord transfer as match start signal.
  // For Minemen/Crystal, we must wait for explicit "Match started!" message,
  // otherwise we miss the Opponent: line that comes during countdown.
  const isMcpvp = record.host.toLowerCase().includes("mcpvp");
  const serverTransferListener = () => {
    if (isMcpvp) {
      matchStarted = true;
      log(rt, "system", "🔆 Beam: MCPVP server transfer detected → match started");
    }
  };
  const respawnListener = () => {
    if (isMcpvp) {
      matchStarted = true;
      log(rt, "system", "🔆 Beam: MCPVP respawn detected → match started");
    }
  };

  bot.on("messagestr", matchStartListener);
  // Listen to transfer signals only for MCPVP
  if (isMcpvp) {
    if (bot._client) {
      bot._client.on("login", serverTransferListener);
      try { bot._client.on("respawn", respawnListener); } catch {}
    }
    try {
      bot.on("spawn", serverTransferListener);
    } catch {}
  }
  
  const waitStart = Date.now();
  // Wait up to 25 seconds for the match to start (Minemen can be slow)
  while (!matchStarted && Date.now() - waitStart < 25000 && rt.beamLoop) {
    await sleep(500);
  }
  if (!matchStarted) {
    log(rt, "system", "🔆 Beam: match start timeout, proceeding anyway");
    matchStarted = true;
  }
  // Keep matchStartListener active for a bit longer to catch late Opponent: messages
  // Don't remove immediately – let it run 3 more seconds after match start
  await sleep(1500);
  bot.removeListener("messagestr", matchStartListener);
  if (isMcpvp) {
    if (bot._client) {
      bot._client.removeListener("login", serverTransferListener);
      try { bot._client.removeListener("respawn", respawnListener); } catch {}
    }
    try { bot.removeListener("spawn", serverTransferListener); } catch {}
  }
  if (!rt.beamLoop) return "stopped";

  // CRITICAL FIX: Clear nmpPlayers when match starts, so we only consider players in arena
  // Previously, nmpPlayers contained lobby players like 1Alphaa1, causing wrong target
  try {
    if (rt.nmpPlayers) {
      log(rt, "system", `🔆 Beam: clearing nmpPlayers (had ${rt.nmpPlayers.size} players) for fresh arena detection`);
      rt.nmpPlayers.clear();
    }
  } catch {}
  
  // FIX: Minemen has 5..1 countdown where chat may be blocked and players vanished
  // Wait 5s to let countdown finish and arena fully load, then clear and wait for player_add
  // During this wait, keep a chat logger active so we don't miss opponent extraction or inbound chat
  const countdownLogger = (msg: any) => {
    const raw = String(msg);
    const low = raw.toLowerCase();
    // Try to extract opponent during countdown if we missed it
    if (low.includes("opponent") && !opponentFromChat) {
      const m = raw.replace(/§./g, " ").match(/Opponent[^A-Za-z0-9_]*([A-Za-z0-9_]{3,16})/i);
      if (m && m[1] && isValidUsername(m[1]) && m[1].toLowerCase() !== self.toLowerCase()) {
        opponentFromChat = m[1].trim();
        log(rt, "system", `🔆 Beam: countdown extracted opponent → ${opponentFromChat}`);
      }
    }
    // Log interesting chat during countdown
    if (raw.includes("»") || raw.includes(":") || low.includes("vs ") || low.includes("match")) {
      log(rt, "system", `🔆 Beam countdown chat: ${raw.slice(0,120)}`);
    }
  };
  bot.on("messagestr", countdownLogger);
  log(rt, "system", "🔆 Beam: waiting 5s for countdown/arena to finish...");
  await sleep(5000);
  bot.removeListener("messagestr", countdownLogger);
  // After countdown, clear again in case lobby players re-added during transfer
  try {
    if (rt.nmpPlayers && rt.nmpPlayers.size > 0) {
      log(rt, "system", `🔆 Beam: post-countdown nmpPlayers has ${rt.nmpPlayers.size}: ${Array.from(rt.nmpPlayers).slice(0,5).join(",")}`);
      // Don't clear if we already have opponent? Actually clear if size > 1 and doesn't contain opponentFromChat
      if (!opponentFromChat || !rt.nmpPlayers.has(opponentFromChat)) {
        // Keep only opponentFromChat if we have it, else clear
        if (opponentFromChat && isValidUsername(opponentFromChat)) {
          const opp = opponentFromChat;
          rt.nmpPlayers.clear();
          rt.nmpPlayers.add(opp);
          log(rt, "system", `🔆 Beam: kept only opponent ${opp} in nmpPlayers`);
        }
      }
    }
  } catch {}
  
  rt.beamStage = "walking forward";
  log(rt, "system", "🔆 Beam: walking forward 2s.");
  try {
    if (typeof bot.setControlState === "function") {
      bot.setControlState("forward", true);
      await sleep(2000);
      bot.setControlState("forward", false);
    } else {
      // For Raw NMP bots, we just sleep.
      await sleep(2000);
    }
  } catch {
    try {
      if (typeof bot.clearControlStates === "function") {
        bot.clearControlStates();
      }
    } catch {
      // ignore
    }
  }

  if (!rt.beamLoop) return "stopped";

  // Use the chat-extracted opponent if we found it! Otherwise fallback to scanning players.
  // BACKUP: Scan recent logs for Opponent: in case matchStartListener missed it due to timing
  if (!opponentFromChat) {
    try {
      // Scan last 30 logs for opponent
      const recentLogs = rt.logs.slice(-40);
      for (let i = recentLogs.length - 1; i >= 0; i--) {
        const line = recentLogs[i].line;
        const clean = line.replace(/[\u00A7\u200B-\u200D\uFEFF●•]/g, " ").replace(/\s+/g, " ").trim();
        if (clean.toLowerCase().includes("opponent")) {
          const m = clean.match(/Opponent[^A-Za-z0-9_]*([A-Za-z0-9_]{3,16})/i);
          if (m && m[1] && isValidUsername(m[1]) && m[1].toLowerCase() !== self.toLowerCase()) {
            const lower = m[1].toLowerCase();
            if (!["map","ping","searching","match","casual","ranked","meadows","crystal","winner","loser"].includes(lower)) {
              opponentFromChat = m[1].trim();
              log(rt, "system", `🔆 Beam: recovered opponent from logs → ${opponentFromChat}`);
              break;
            }
          }
          // Fallback: extract all usernames
          const all = clean.match(/[A-Za-z0-9_]{3,16}/g) || [];
          const filtered = all.filter(n => {
            const l = n.toLowerCase();
            if (["opponent","map","ping","searching","match","casual","ranked","meadows","crystal","winner","loser","tournament","host","mode","players","starting","click","join"].includes(l)) return false;
            return isValidUsername(n) && l !== self.toLowerCase();
          });
          if (filtered.length > 0) {
            opponentFromChat = filtered[filtered.length - 1];
            log(rt, "system", `🔆 Beam: recovered opponent from logs (fallback) → ${opponentFromChat}`);
            break;
          }
        }
      }
    } catch {}
  }

  let target = opponentFromChat || findNearestPlayer(rt, self);
  let retries = 5;
  while (!target && retries > 0 && rt.beamLoop) {
    rt.beamStage = "looking for player…";
    log(rt, "system", "🔆 Beam: looking for opponent (waiting 1s)...");
    await sleep(1000);
    // If opponentFromChat is still null, keep checking the game world
    target = opponentFromChat || findNearestPlayer(rt, self);
    retries--;
  }
  
  if (!target || !isValidUsername(target)) {
    rt.beamStage = "no valid player nearby";
    log(rt, "system", "🔆 Beam: no valid nearby player found.");
    return "noplayer";
  }
  log(rt, "system", `🔆 Beam: target → ${target}.`);

  // Death detection.
  let died = false;
  const onDeath = () => {
    died = true;
  };
  bot.once("death", onDeath);

  // Detect when the target player leaves the game.
  let targetLeft = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onPlayerLeft = (player: any) => {
    if (
      player?.username &&
      String(player.username).toLowerCase() === target.toLowerCase()
    ) {
      targetLeft = true;
    }
  };
  bot.on("playerLeft", onPlayerLeft);

  // Persistent reply capture: whispers FROM target OR target's public chat.
  const inbox: string[] = [];
  
  // Debug logger for ALL chat during beam – helps diagnose why messages not received
  const debugChatLogger = (message: any) => {
    let raw = "";
    if (typeof message === "string") raw = message;
    else if (message && typeof message === "object") {
      if (typeof message.text === "string") raw = message.text;
      else if (typeof message.message === "string") raw = message.message;
      else raw = String(message);
    } else raw = String(message);
    if (!raw) return;
    if (raw.includes("<you") || raw.includes("<you →")) return;
    const low = raw.toLowerCase();
    if (low.includes("opponent") || low.includes("winner") || low.includes("loser") || 
        low.includes("was killed") || low.includes("disconnected") || low.includes("left the") ||
        raw.includes(":") || raw.includes("»") || raw.includes("→") || raw.includes("whispers") || raw.includes("From")) {
      if (!low.includes("map:") || low.includes("opponent")) {
        if (low.includes(target.toLowerCase()) || Math.random() < 0.3) {
          log(rt, "system", `🔆 Beam debug chat: ${raw.slice(0,120)}`);
        }
      }
    }
  };

  // Track server acks for /msg to confirm delivery
  let lastMsgAck = 0;
  const ackListener = (msg: any) => {
    const raw = String(msg);
    const low = raw.toLowerCase();
    if (
      (low.includes(`(to ${target.toLowerCase()})`) || low.includes(`to ${target.toLowerCase()}`)) &&
      (low.includes("you") || raw.includes("→") || raw.includes("->") || low.includes("whisper"))
    ) {
      lastMsgAck = Date.now();
      log(rt, "system", `🔆 Beam: server ack for /msg to ${target} confirmed`);
    }
    if (low.includes("cannot message") || low.includes("player not found") || low.includes("is not online") || low.includes("you cannot message")) {
      if (low.includes(target.toLowerCase())) {
        log(rt, "system", `🔆 Beam: server says cannot message ${target}: ${raw.slice(0,100)}`);
      }
    }
  };

  const onMsg = (message: any) => {
    // Handle both string (messagestr) and object (chat event with username/message)
    let raw = "";
    if (typeof message === "string") raw = message;
    else if (message && typeof message === "object") {
      // mineflayer chat event: (username, message) or {username, message}
      if (typeof message.text === "string") raw = message.text;
      else if (typeof message.message === "string") raw = message.message;
      else if (Array.isArray(message) && message.length >= 2) raw = `${message[0]}: ${message[1]}`;
      else raw = String(message);
    } else raw = String(message);
    if (!raw) return;
    const low = raw.toLowerCase();

    // --- Match Results detection (the reliable death/leave signal) ---
    if (low.includes("winner:") && low.includes("loser:")) {
      const winMatch = raw.match(/winner\s*:\s*([A-Za-z0-9_]+)/i);
      const loseMatch = raw.match(/loser\s*:\s*([A-Za-z0-9_]+)/i);
      const winner = winMatch?.[1]?.toLowerCase();
      const loser = loseMatch?.[1]?.toLowerCase();
      if (loser === self.toLowerCase()) {
        died = true;
        log(rt, "system", "🔆 Beam: match results show I was killed.");
      } else if (winner === self.toLowerCase()) {
        log(rt, "system", "🔆 Beam: match results show opponent died/left.");
        if (loser && loser === target.toLowerCase()) targetLeft = true;
      }
      return;
    }

    const killMatch = raw.match(/([A-Za-z0-9_]+)\s+was killed by\s+([A-Za-z0-9_]+)/i);
    if (killMatch) {
      const victim = killMatch[1].toLowerCase();
      if (victim === self.toLowerCase()) {
        died = true;
        log(rt, "system", "🔆 Beam: I was killed.");
        return;
      }
      if (victim === target.toLowerCase()) {
        targetLeft = true;
        return;
      }
    }

    if (
      low.includes(target.toLowerCase()) &&
      (low.includes("disconnected") || low.includes("left the game") || low.includes("left the match") || low.includes("has left"))
    ) {
      targetLeft = true;
      log(rt, "system", `🔆 Beam: ${target} left detected via chat`);
      return;
    }

    // Detect /msg failures
    if (low.includes("cannot message") || low.includes("player not found") || low.includes("is not online") || low.includes("you cannot")) {
      if (low.includes(target.toLowerCase()) || low.includes("message")) {
        log(rt, "system", `🔆 Beam: /msg failed: ${raw.slice(0,100)}`);
      }
    }

    // Whisper from the target (private) – try all formats
    const whisper = parseWhisperFrom(raw, target);
    if (whisper) {
      log(rt, "system", `🔆 Beam: got whisper from ${target}: \"${whisper.slice(0,80)}\"`);
      inbox.push(whisper);
      return;
    }
    // Public chat from the target
    const pub = parsePublicChatFrom(raw, target);
    if (pub) {
      log(rt, "system", `🔆 Beam: got public from ${target}: \"${pub.slice(0,80)}\"`);
      inbox.push(pub);
      return;
    }
    // Fallback: any chat containing target name
    const any = parseAnyChatFrom(raw, target);
    if (any) {
      log(rt, "system", `🔆 Beam: got fallback from ${target}: \"${any.slice(0,80)}\"`);
      inbox.push(any);
      return;
    }
  };
  // FIX: Keep references to chat listeners so we can remove them properly
  const onChatMineflayer = (username: string, message: string) => {
    if (!username || !message) return;
    if (username.toLowerCase() === self.toLowerCase()) return;
    // For mineflayer, username is already parsed, so we can directly check
    if (username.toLowerCase() === target.toLowerCase()) {
      log(rt, "system", `🔆 Beam: got chat event from ${target}: \"${message.slice(0,80)}\"`);
      inbox.push(message);
    }
    onMsg(`${username}: ${message}`);
  };
  // Listen to multiple events to ensure we don't miss chat after arena switch
  bot.on("messagestr", onMsg);
  bot.on("messagestr", debugChatLogger);
  bot.on("messagestr", ackListener);
  // For mineflayer bots, also listen to chat event (username, message)
  try {
    bot.on("chat", onChatMineflayer);
  } catch {}
  // For Azalea, also listen to any other chat-like events
  try {
    bot.on("systemChat", (data: any) => {
      let text = "";
      try {
        if (typeof data === "string") text = data;
        else if (data?.formattedMessage) {
          try { text = extractText(JSON.parse(data.formattedMessage)); } catch { text = String(data.formattedMessage); }
        } else if (data?.content) {
          try { text = extractText(JSON.parse(data.content)); } catch { text = String(data.content); }
        } else text = String(data);
      } catch { text = String(data); }
      if (text) {
        debugChatLogger(text);
        onMsg(text);
        ackListener(text);
      }
    });
  } catch {}

  const history: { who: "me" | "them"; text: string }[] = [];

  const whisper = async (line: string, gap = SEND_GAP) => {
    const isMcpvp = record.host.toLowerCase().includes("mcpvp");
    try {
      // SIMPLIFIED: One method per server type to avoid spam filter
      // Minemen/Crystal: /msg is primary and reliable, public is backup only if /msg fails
      // MCPVP: public chat is isolated to duel arena, so public is primary
      
      if (isMcpvp) {
        // MCPVP: public chat is duel-local, /msg often disabled
        try {
          if (typeof bot.chat === "function") {
            bot.chat(line);
          } else if (bot.write) {
            bot.write("chat", { message: line });
          }
          log(rt, "chat", `<you> ${line}`);
          log(rt, "system", `🔆 Beam: sent public (MCPVP) → \"${line.slice(0,60)}\"`);
        } catch (e) {
          log(rt, "error", `public chat failed (MCPVP): ${String(e).slice(0,80)}`);
          // Fallback to /msg
          try {
            if (typeof bot.chat === "function") {
              bot.chat(`/msg ${target} ${line}`);
              log(rt, "chat", `<you → ${target}> ${line} (fallback)`);
            }
          } catch {}
        }
      } else {
        // Minemen / Crystal / others: /msg is reliable
        // We do ONE /msg attempt, log it, and push to history
        // The ackListener will confirm if server accepted it
        try {
          lastMsgAck = 0;
          if (typeof bot.chat === "function") {
            bot.chat(`/msg ${target} ${line}`);
          } else if (bot.write) {
            bot.write("chat", { message: `/msg ${target} ${line}` });
          }
          // Log immediately as <you → target> so user sees attempt even before ack
          log(rt, "chat", `<you → ${target}> ${line}`);
          log(rt, "system", `🔆 Beam: sent /msg to ${target}: \"${line.slice(0,60)}\"`);
        } catch (e) {
          log(rt, "error", `/msg failed for ${target}: ${String(e).slice(0,100)}`);
          // Fallback: try public chat as last resort (arena chat visible to opponent in Minemen)
          try {
            if (typeof bot.chat === "function") {
              bot.chat(line);
              log(rt, "chat", `<you> ${line} (public fallback)`);
              log(rt, "system", `🔆 Beam: sent public fallback: \"${line.slice(0,60)}\"`);
            }
          } catch {}
        }
        
        // Wait 800ms to see if we get ack, but don't block too long
        // If no ack in 2s, we will try public as backup on next message? No, keep it simple.
        // Just wait a bit for server to process
        await sleep(600);
      }
      history.push({ who: "me", text: line });
    } catch (e) {
      log(rt, "error", `whisper send failed: ${String(e).slice(0,120)}`);
    }
    await sleep(humanGap(gap, 0.22));
  };

  // Send a reply as SEPARATE human-style messages instead of one big dump.
  // Splits on sentence breaks / " and " / " cuz " etc so it reads like a real
  // person typing a few short lines.
  const whisperHuman = async (text: string, gap = SEND_GAP) => {
    const clean = text.trim();
    if (!clean) return;
    // Break into natural chunks.
    let parts = clean
      .split(/(?<=[.!?])\s+|\s*[\n;]+\s+|\s+\b(?:and then|then)\b\s+/i)
      .map((p) => p.replace(/^[,.\s]+|[,.\s]+$/g, "").trim())
      .filter((p) => p.length > 0);
    // If still one long run-on, split on " cuz "/" cause "/" and ".
    if (parts.length === 1 && clean.length > 60) {
      parts = clean
        .split(/\s+\b(?:cuz|cause|because|and)\b\s+/i)
        .map((p) => p.trim())
        .filter(Boolean);
    }
    if (parts.length === 0) parts = [clean];
    // Cap to 3 messages so it never spams.
    parts = parts.slice(0, 3);
    for (let i = 0; i < parts.length; i++) {
      if (!rt.beamLoop) return;
      await whisper(parts[i], i === parts.length - 1 ? gap : humanGap(1300, 0.3));
    }
  };

  // Persistent cursor of how many inbox messages we've already consumed.
  // This ensures replies that arrive DURING the opener (before we start
  // waiting) are not skipped — they get picked up on the next read.
  let consumed = 0;

    // Interruptible gap: wait up to `ms`, but return early the moment a new
    // reply arrives. Returns true if a reply is now pending.
    const gapOrReply = async (ms: number): Promise<boolean> => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        if (!rt.beamLoop || died) return inbox.length > consumed;
        if (inbox.length > consumed) {
          await sleep(500); // settle for follow-up lines
          return true;
        }
        await sleep(150);
      }
      return inbox.length > consumed;
    };

    const doLeave = (why: string) => {
      log(rt, "system", `🔆 Beam: ${why} → /leave.`);
      try {
        bot.chat("/leave");
        log(rt, "chat", "<you → server> /leave");
      } catch {
        // ignore
      }
    };

    // After they agree: ask for gamemode -> wait for answer -> drop discord -> wait for them to leave.
    const runClosing = async (): Promise<
      "positive" | "died" | "stopped"
    > => {
      rt.beamStage = "positive → asking gamemode";
      log(rt, "system", "🔆 Beam: positive! Asking for gamemode.");
      
      await whisper("ayy lets go, what gamemode u good at?");
      if (died) return "died";
      if (!rt.beamLoop) return "stopped";

      // Wait up to 30s for them to answer the gamemode question.
      await gapOrReply(30000);
      if (died) return "died";
      if (!rt.beamLoop) return "stopped";

      // Consume their reply if they sent one.
      if (inbox.length > consumed) {
        const r = inbox.slice(consumed).join(" ");
        consumed = inbox.length;
        history.push({ who: "them", text: r });
        log(rt, "system", `🔆 Beam: ${target} answered gamemode: "${r.slice(0, 60)}"`);
      }

      // Now hardcode the Discord drop so the AI doesn't get stuck chatting forever.
      rt.beamStage = "dropping discord";
      await whisper(`could u add my discord ${discordUser} pls, its starting soon`);
      if (died) return "died";
      if (!rt.beamLoop) return "stopped";
      await whisper("then ill send the where to hop on");
      await whisper("thanks man");
      log(rt, "system", "🔆 Beam: closing script sent.");

      let gaveIp = false;
      const safeIp = serverIp.replace(/\./g, " [dot] ");

      // Now wait for them to leave the server (meaning they went to add discord).
      rt.beamStage = `waiting for ${target} to leave…`;
      const MAX_WAIT = 300000; // 5 min safety cap
      const startedAt = Date.now();
      
      while (rt.beamLoop && !died && !targetLeft) {
        if (Date.now() - startedAt > MAX_WAIT) break;
        await gapOrReply(15000);
        if (died) return "died";
        if (!rt.beamLoop) return "stopped";
        if (targetLeft) break;
        if (inbox.length <= consumed) continue; // silence → keep waiting

        const r = inbox.slice(consumed).join(" ");
        consumed = inbox.length;
        history.push({ who: "them", text: r });
        log(rt, "system", `🔆 Beam: ${target} said "${r.slice(0, 60)}"`);

        const lr = r.toLowerCase();
        
        // Did they reject us after the discord drop?
        const hardNo = /\b(no thanks|nty|nvm|never ?mind|not interested|stop|go away|leave me|fuck off|piss off)\b/.test(lr);
        if (hardNo) {
          doLeave("they declined");
          break;
        }

        // Did they say they sent the request?
        const sent = /\b(sent|added|added you|add(ed)? u|joined|joining|im in|i'?m in|ready|added ya|friended|on it|coming)\b/.test(lr);
        if (sent) {
          // Send to AI so it replies naturally (e.g. "alright one sec please").
          const aiSent = await aiConverse(channel, self, history, r, safeIp, discordUser);
          if (aiSent.reply) {
            await whisperHuman(aiSent.reply);
          } else {
            await whisper("alright one sec please");
          }
          continue; // keep waiting for them to leave
        }

        // Do they not have Discord? Give the IP.
        const noDiscord = /\b(idh|i ?don'?t have|no discord|dont have discord|cant use discord|can'?t use discord|cannot use discord|no dc|dont use discord)\b/.test(lr);
        if (noDiscord && !gaveIp) {
          gaveIp = true;
          const ai2 = await aiConverse(channel, self, history, r, safeIp, discordUser);
          if (ai2.reply) {
            await whisperHuman(ai2.reply);
          } else {
            await whisper(`ohh all good, just hop on ${safeIp} then`);
          }
          if (!ai2.reply || !ai2.reply.toLowerCase().includes(safeIp.toLowerCase().replace(/\[dot\]/g, ""))) {
            await whisper(`ip is ${safeIp}, hop on when ur free`);
          }
          log(rt, "system", "🔆 Beam: gave IP. Waiting 10s for final reply...");
          await gapOrReply(10000);
          doLeave("gave IP, leaving");
          break;
        }

        // Otherwise, let AI handle any random questions while we wait for them to leave.
        const ai2 = await aiConverse(channel, self, history, r, safeIp, discordUser);
        if (ai2.intent === "negative") {
          doLeave("they declined");
          break;
        }
        if (ai2.reply) {
          await whisperHuman(ai2.reply);
        }
      }

      log(
        rt,
        "system",
        targetLeft
          ? `🔆 Beam: ${target} left → restarting.`
          : "🔆 Beam: done with this convo → restarting.",
      );
      return "positive";
    };

    // Process whatever the target just said. Returns next action.
    const handleReply = async (): Promise<
      "negative" | "positive" | "continue" | "died" | "stopped"
    > => {
      if (inbox.length <= consumed) return "continue";
      const reply = inbox.slice(consumed).join(" ");
      consumed = inbox.length;
      history.push({ who: "them", text: reply });
      log(rt, "system", `🔆 Beam: ${target} said "${reply.slice(0, 60)}"`);

      const ai = await aiConverse(channel, self, history, reply, serverIp, discordUser);
      log(rt, "system", `🔆 Beam: intent=${ai.intent.toUpperCase()}.`);

      if (ai.intent === "negative") {
        doLeave("declined");
        return "negative";
      }
      if (ai.intent === "positive") {
        return await runClosing();
      }
      // question / neutral → reply in-character (split into human messages).
      if (ai.reply) await whisperHuman(ai.reply);
      else if (ai.intent === "question") await whisper(`its ${channel}`);
      if (died) return "died";
      if (!rt.beamLoop) return "stopped";
      return "continue";
    };

    const settle = (o: string): "negative" | "positive" | "died" | "stopped" =>
      o as "negative" | "positive" | "died" | "stopped";

  let outcome: "positive" | "negative" | "died" | "noplayer" | "stopped" =
    "stopped";
  try {
    outcome = await (async (): Promise<
      "positive" | "negative" | "died" | "stopped"
    > => {
    // Opener — Randomize greetings and pitches to look human and avoid anti-spam
    const greetings = ["hi", "hey", "yo", "sup", "hello"];
    const pitches = [
      "can u help me film a yt video",
      "need some help recording a yt vid",
      "could u help me film a video for my channel",
      "u down to help me record a video"
    ];
    const reasons = [
      "Cuz i got a challenge of a 2v2 if we win we will get a rankup",
      "its a 2v2 challenge and we both get a rankup if we win",
      "im doing a 2v2 challenge where we rank up if we win"
    ];

    const greet = greetings[Math.floor(Math.random() * greetings.length)];
    const pitch = pitches[Math.floor(Math.random() * pitches.length)];
    const reason = reasons[Math.floor(Math.random() * reasons.length)];

    rt.beamStage = `messaging ${target}`;

    await whisper(greet, 0);
    if (await gapOrReply(1000)) {
      const o = await handleReply();
      if (o !== "continue") return settle(o);
    } else if (died) return "died";
    else if (!rt.beamLoop) return "stopped";

    if (inbox.length <= consumed) {
      await whisper(pitch, 0);
      if (await gapOrReply(3000)) {
        const o = await handleReply();
        if (o !== "continue") return settle(o);
      } else if (died) return "died";
      else if (!rt.beamLoop) return "stopped";
    }

    if (inbox.length <= consumed) {
      await whisper(reason, 0);
      if (await gapOrReply(2600)) {
        const o = await handleReply();
        if (o !== "continue") return settle(o);
      } else if (died) return "died";
      else if (!rt.beamLoop) return "stopped";
    }

    // Ongoing conversation loop (before they've agreed).
    // Wait 10s LONGER than before (30s) so slow repliers aren't dropped.
    let turns = 0;
    while (rt.beamLoop && !died && turns < 10) {
      turns++;
      rt.beamStage = `waiting for ${target}…`;
      const got = await gapOrReply(30000);
      if (died) return "died";
      if (!rt.beamLoop) return "stopped";
      if (!got) {
        await sleep(1500);
        doLeave("no reply");
        await sleep(500);
        return "negative";
      }
      const o = await handleReply();
      if (o !== "continue") return settle(o);
    }
    return died ? "died" : "negative";
    })();
    return outcome;
  } finally {
    bot.removeListener("messagestr", onMsg);
    try { bot.removeListener("messagestr", debugChatLogger); } catch {}
    try { bot.removeListener("messagestr", ackListener); } catch {}
    try { bot.removeListener("chat", onChatMineflayer); } catch {}
    try { bot.removeListener("chat", onMsg); } catch {}
    try { bot.removeListener("systemChat", onMsg); } catch {}
    try { bot.removeListener("systemChat", debugChatLogger); } catch {}
    try { bot.removeListener("systemChat", ackListener); } catch {}
    bot.removeListener("death", onDeath);
    bot.removeListener("playerLeft", onPlayerLeft);
    try {
      if (typeof bot.setControlState === "function") {
        bot.setControlState("forward", false);
      }
    } catch {
      // ignore
    }
    // Save the conversation for AI training/analysis (best effort).
    try {
      const { recordConversation } = await import("@/lib/training");
      void recordConversation({
        botId: rt.id,
        target,
        outcome,
        transcript: history,
      });
    } catch {
      // ignore
    }
  }
}

// Start the beam LOOP: keeps recruiting (restarting on deny/death) until stopped.
export async function startBeam(id: string): Promise<BotActionResult> {
  const rt = runtimes.get(id);
  if (!rt || !rt.bot || rt.status !== "online") {
    return { ok: false, message: "Bot must be online and in-game to beam" };
  }
  if (rt.beamLoop) {
    return { ok: false, message: "Beam already running" };
  }

  // Read the YT channel + beam IP from the DB record.
  let channel = "Alight.z";
  let record: Bot | null = null;
  try {
    const [rec] = await db.select().from(bots).where(eq(bots.id, id));
    if (rec) record = rec;
  } catch {
    // ignore, use default
  }

  if (!record) return { ok: false, message: "Bot record not found" };

  rt.beamLoop = true;
  rt.beaming = true;
  rt.beamStage = "starting";
  log(rt, "system", `🔆 Beam loop started (type: ${record.beamType}).`);

  (async () => {
    try {
      while (rt.beamLoop && rt.bot && rt.status === "online") {
        const outcome = await runBeamOnce(rt, record);
        if (!rt.beamLoop) break;
        if (outcome === "stopped") break;
        if (outcome === "positive") {
          // Recruited someone — keep looping to the next player after a pause.
          log(rt, "system", "🔆 Beam: success → next target shortly.");
          rt.beamStage = "cooldown after success";
          await sleep(5000);
        } else {
          // denied / died / no player → wait 5s (let the match results / death
          // sequence settle, avoids targeting color-code junk) then restart.
          log(
            rt,
            "system",
            `🔆 Beam: ${outcome} → restarting beam in 5s.`,
          );
          rt.beamStage = `restarting (${outcome})`;
          await sleep(5000);
        }
      }
    } catch (err) {
      log(
        rt,
        "error",
        "Beam loop error: " +
          (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      rt.beaming = false;
      rt.beamLoop = false;
      rt.beamStage = "";
      try {
        rt.bot?.setControlState("forward", false);
      } catch {
        // ignore
      }
      log(rt, "system", "🔆 Beam loop stopped.");
    }
  })();

  return { ok: true, message: "Beam started" };
}

export async function stopBeam(id: string): Promise<BotActionResult> {
  const rt = runtimes.get(id);
  if (!rt) return { ok: false, message: "Bot not found" };
  if (!rt.beamLoop && !rt.beaming) {
    return { ok: false, message: "Beam is not running" };
  }
  rt.beamLoop = false;
  rt.beamStage = "stopping…";
  log(rt, "system", "🔆 Beam: stop requested.");
  try {
    rt.bot?.setControlState("forward", false);
  } catch {
    // ignore
  }
  return { ok: true, message: "Beam stopping" };
}
