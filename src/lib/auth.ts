import crypto from "crypto";
import { cookies } from "next/headers";
import { db } from "@/db";
import { users, bots, type User } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  SESSION_SECRET,
  ADMIN_DISCORD_ID,
  ADMIN_USERNAMES,
  isDiscordConfigured as cfgDiscord,
} from "@/lib/config";

const PBKDF2_ITER = 100000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = "sha512";

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITER, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = crypto.pbkdf2Sync(password, salt, PBKDF2_ITER, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(derived, "hex"));
  } catch {
    return false;
  }
}

const COOKIE_NAME = "mcbm_session";
const SECRET = SESSION_SECRET;
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function sign(value: string): string {
  return crypto.createHmac("sha256", SECRET).update(value).digest("hex");
}

export function makeSessionToken(userId: string): string {
  const payload = `${userId}.${Date.now()}`;
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

function verifyToken(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, ts, sig] = parts;
  const expected = sign(`${userId}.${ts}`);
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  return userId;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const SESSION_MAX_AGE = MAX_AGE;

export const sessionCookieOptions = {
  httpOnly: true,
  // "none" is required so the session survives when the app is viewed inside
  // a cross-site embedded preview (e.g. an iframe). Secure is already set.
  sameSite: "none" as const,
  secure: true,
  path: "/",
  maxAge: MAX_AGE,
};

export async function setSessionCookie(userId: string) {
  const store = await cookies();
  store.set(COOKIE_NAME, makeSessionToken(userId), sessionCookieOptions);
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
}

// Attach the session cookie directly to a NextResponse. This is required when
// returning a redirect/json response, because cookies().set() mutations are
// NOT applied to a manually-constructed Response (a Next.js gotcha that
// silently dropped logins).
export function attachSessionCookie(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res: { cookies: { set: (name: string, value: string, opts?: any) => void } },
  userId: string,
) {
  res.cookies.set(COOKIE_NAME, makeSessionToken(userId), sessionCookieOptions);
}

export function attachClearCookie(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res: { cookies: { set: (name: string, value: string, opts?: any) => void } },
) {
  res.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
}

export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  const userId = verifyToken(token);
  if (!userId) return null;
  try {
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    return u ?? null;
  } catch {
    return null;
  }
}

// Returns the current user if they own the given bot (admins own all).
export async function authorizeBot(
  botId: string,
): Promise<{ user: User; ok: true } | { user: User | null; ok: false }> {
  const user = await getCurrentUser();
  if (!user) return { user: null, ok: false };
  if (user.role === "admin") return { user, ok: true };
  const [b] = await db.select().from(bots).where(eq(bots.id, botId));
  if (b && b.userId === user.id) return { user, ok: true };
  return { user, ok: false };
}

export function isDiscordConfigured(): boolean {
  return cfgDiscord();
}

// Upsert a user from Discord profile, promoting to admin when appropriate.
export async function upsertDiscordUser(profile: {
  discordId: string;
  username: string;
  handle?: string;
  avatar: string | null;
}): Promise<User> {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.discordId, profile.discordId));

  // Admin rule: matches ADMIN_DISCORD_ID, the configured admin usernames,
  // or the very first user in the system.
  const adminDiscordId = ADMIN_DISCORD_ID;
  const handleLower = (profile.handle || profile.username).toLowerCase();
  const nameLower = profile.username.toLowerCase();
  const totalUsers = await db.select({ id: users.id }).from(users);
  const shouldBeAdmin =
    (adminDiscordId && adminDiscordId === profile.discordId) ||
    ADMIN_USERNAMES.includes(handleLower) ||
    ADMIN_USERNAMES.includes(nameLower) ||
    totalUsers.length === 0;

  if (existing) {
    const [updated] = await db
      .update(users)
      .set({
        username: profile.username,
        avatar: profile.avatar,
        ...(shouldBeAdmin && existing.role !== "admin"
          ? { role: "admin" }
          : {}),
      })
      .where(eq(users.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(users)
    .values({
      discordId: profile.discordId,
      username: profile.username,
      avatar: profile.avatar,
      role: shouldBeAdmin ? "admin" : "user",
      botSlots: 0,
    })
    .returning();
  return created;
}

// Create or fetch a dev/guest account (used when Discord isn't configured).
export async function getOrCreateDevUser(name: string): Promise<User> {
  const handle = name.trim().slice(0, 24) || "guest";
  const devId = `dev:${handle.toLowerCase()}`;
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.discordId, devId));
  if (existing) return existing;

  const totalUsers = await db.select({ id: users.id }).from(users);
  const shouldBeAdmin = totalUsers.length === 0;
  const [created] = await db
    .insert(users)
    .values({
      discordId: devId,
      username: handle,
      avatar: null,
      role: shouldBeAdmin ? "admin" : "user",
      botSlots: 0,
    })
    .returning();
  return created;
}

export async function createLocalUser(params: {
  username: string;
  password: string;
  role?: string;
}): Promise<User> {
  const { username, password, role } = params;
  const cleanName = username.trim().slice(0, 32);
  if (!cleanName) throw new Error("Username required");
  if (password.length < 3) throw new Error("Password too short");

  const existing = await db.select().from(users).where(eq(users.username, cleanName));
  if (existing.length > 0) {
    throw new Error("Username already taken");
  }

  const totalUsers = await db.select({ id: users.id }).from(users);
  const shouldBeAdmin = totalUsers.length === 0 || role === "admin";

  const [created] = await db
    .insert(users)
    .values({
      discordId: `local:${cleanName.toLowerCase()}:${Date.now()}`,
      username: cleanName,
      avatar: null,
      role: shouldBeAdmin ? "admin" : role || "user",
      botSlots: 0,
      passwordHash: hashPassword(password),
    })
    .returning();
  return created;
}

export async function authenticateLocalUser(username: string, password: string): Promise<User | null> {
  const cleanName = username.trim();
  if (!cleanName) return null;
  const [user] = await db.select().from(users).where(eq(users.username, cleanName));
  if (!user) return null;
  if (!user.passwordHash) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return user;
}

export async function registerLocalUser(username: string, password: string): Promise<User> {
  return createLocalUser({ username, password, role: "user" });
}
