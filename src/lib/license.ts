import { db } from "@/db";
import { users, licenses, licenseKeys, bots } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import crypto from "crypto";

export type LicenseInfo = {
  id: string;
  slots: number;
  durationDays: number;
  durationHours: number;
  expiresAt: Date;
  active: boolean;
  reason: string;
  licenseKey?: string;
  createdAt: Date;
  isExpired: boolean;
  timeLeft: string;
};

export type LicenseKeyInfo = {
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
  redeemedAt?: Date | null;
  createdBy?: string | null;
  createdAt: Date;
};

export type UserLicenseStatus = {
  totalSlots: number;
  usedSlots: number;
  availableSlots: number;
  activeLicenses: LicenseInfo[];
  expiredLicenses: LicenseInfo[];
  hasActiveLicense: boolean;
  nextExpiry: Date | null;
};

function formatTimeLeft(expiresAt: Date): string {
  const now = new Date();
  const diff = expiresAt.getTime() - now.getTime();
  if (diff <= 0) return "Expired";

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  if (days > 0) {
    return `${days}d ${remainingHours}h left`;
  }
  return `${hours}h left`;
}

export function formatTimeLeftPublic(expiresAt: Date): string {
  return formatTimeLeft(expiresAt);
}

function generateRandomSuffix(length = 12): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

export function generateLicenseKey(): string {
  // New format: abeam-key-awqkk192p-12kasj (like 9 chars + dash + 6 chars)
  // Example: abeam-key-x7k9p2m4q1-8f3j2k
  const part1 = generateRandomSuffix(9); // e.g. awqkk192p
  const part2 = generateRandomSuffix(6); // e.g. 12kasj
  return `abeam-key-${part1}-${part2}`;
}

/**
 * Get all licenses for a user and calculate current status
 */
export async function getUserLicenseStatus(userId: string): Promise<UserLicenseStatus> {
  try {
    const userLicenses = await db
      .select()
      .from(licenses)
      .where(eq(licenses.userId, userId))
      .orderBy(desc(licenses.createdAt));

    const now = new Date();
    const activeLicenses: LicenseInfo[] = [];
    const expiredLicenses: LicenseInfo[] = [];
    let totalSlots = 0;
    let nextExpiry: Date | null = null;

    for (const lic of userLicenses) {
      const isExpired = lic.expiresAt <= now || lic.active !== "true";
      const info: LicenseInfo = {
        id: lic.id,
        slots: lic.slots,
        durationDays: lic.durationDays,
        durationHours: lic.durationHours,
        expiresAt: lic.expiresAt,
        active: lic.active === "true" && !isExpired,
        reason: lic.reason,
        licenseKey: lic.licenseKey,
        createdAt: lic.createdAt,
        isExpired,
        timeLeft: formatTimeLeft(lic.expiresAt),
      };

      if (isExpired) {
        expiredLicenses.push(info);
      } else {
        activeLicenses.push(info);
        totalSlots += lic.slots;
        if (!nextExpiry || lic.expiresAt < nextExpiry) {
          nextExpiry = lic.expiresAt;
        }
      }
    }

    // Also include base botSlots from users table (for admin override or legacy)
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (user && user.botSlots > 0) {
      totalSlots += user.botSlots;
    }

    const owned = await db
      .select({ id: bots.id })
      .from(bots)
      .where(eq(bots.userId, userId));

    const usedSlots = owned.length;
    const availableSlots = Math.max(0, totalSlots - usedSlots);

    return {
      totalSlots,
      usedSlots,
      availableSlots,
      activeLicenses,
      expiredLicenses,
      hasActiveLicense: activeLicenses.length > 0 || (user?.role === "admin"),
      nextExpiry,
    };
  } catch (err) {
    console.error("Failed to get license status:", err);
    return {
      totalSlots: 0,
      usedSlots: 0,
      availableSlots: 0,
      activeLicenses: [],
      expiredLicenses: [],
      hasActiveLicense: false,
      nextExpiry: null,
    };
  }
}

/**
 * Create a new license directly for a user (legacy direct assignment)
 */
export async function createLicense(params: {
  userId: string;
  slots: number;
  durationDays: number;
  durationHours: number;
  reason?: string;
  createdBy?: string;
  licenseKey?: string;
}): Promise<LicenseInfo> {
  const { userId, slots, durationDays, durationHours, reason, createdBy, licenseKey } = params;

  if (slots <= 0) throw new Error("Slots must be > 0");
  if (durationDays < 0 || durationHours < 0) throw new Error("Duration cannot be negative");
  if (durationDays === 0 && durationHours === 0) throw new Error("Duration must be at least 1 hour");

  const now = new Date();
  const totalHours = durationDays * 24 + durationHours;
  const expiresAt = new Date(now.getTime() + totalHours * 60 * 60 * 1000);

  const [license] = await db
    .insert(licenses)
    .values({
      userId,
      slots,
      durationDays,
      durationHours,
      expiresAt,
      active: "true",
      reason: reason || "",
      licenseKey: licenseKey || "",
      createdBy: createdBy || null,
    })
    .returning();

  return {
    id: license.id,
    slots: license.slots,
    durationDays: license.durationDays,
    durationHours: license.durationHours,
    expiresAt: license.expiresAt,
    active: true,
    reason: license.reason,
    licenseKey: license.licenseKey,
    createdAt: license.createdAt,
    isExpired: false,
    timeLeft: formatTimeLeft(license.expiresAt),
  };
}

/**
 * Create a redeemable license key (admin generates key like abeam-key-xxx)
 */
export async function createLicenseKey(params: {
  slots: number;
  durationDays: number;
  durationHours: number;
  reason?: string;
  createdBy?: string;
}): Promise<LicenseKeyInfo> {
  const { slots, durationDays, durationHours, reason, createdBy } = params;

  if (slots <= 0) throw new Error("Slots must be > 0");
  if (durationDays < 0 || durationHours < 0) throw new Error("Duration cannot be negative");
  if (durationDays === 0 && durationHours === 0) throw new Error("Duration must be at least 1 hour");

  let key: string;
  let attempts = 0;
  do {
    key = generateLicenseKey();
    attempts++;
    if (attempts > 10) throw new Error("Failed to generate unique key");
    const existing = await db.select().from(licenseKeys).where(eq(licenseKeys.key, key));
    if (existing.length === 0) break;
  } while (true);

  const [created] = await db
    .insert(licenseKeys)
    .values({
      key,
      slots,
      durationDays,
      durationHours,
      reason: reason || "",
      active: "true",
      redeemed: "false",
      createdBy: createdBy || null,
    })
    .returning();

  return {
    id: created.id,
    key: created.key,
    slots: created.slots,
    durationDays: created.durationDays,
    durationHours: created.durationHours,
    reason: created.reason,
    active: created.active === "true",
    redeemed: created.redeemed === "true",
    redeemedBy: created.redeemedBy,
    redeemedAt: created.redeemedAt,
    createdBy: created.createdBy,
    createdAt: created.createdAt,
  };
}

/**
 * Redeem a license key - user enters key like abeam-key-xxx
 */
export async function redeemLicenseKey(userId: string, key: string): Promise<LicenseInfo> {
  const trimmedKey = key.trim();
  if (!trimmedKey) throw new Error("License key required");

  const [lk] = await db.select().from(licenseKeys).where(eq(licenseKeys.key, trimmedKey));
  if (!lk) {
    throw new Error("Invalid license key");
  }

  if (lk.active !== "true") {
    throw new Error("License key is inactive");
  }

  if (lk.redeemed === "true") {
    throw new Error("License key already redeemed");
  }

  // Create license for user
  const now = new Date();
  const totalHours = lk.durationDays * 24 + lk.durationHours;
  const expiresAt = new Date(now.getTime() + totalHours * 60 * 60 * 1000);

  const [license] = await db
    .insert(licenses)
    .values({
      userId,
      slots: lk.slots,
      durationDays: lk.durationDays,
      durationHours: lk.durationHours,
      expiresAt,
      active: "true",
      reason: lk.reason,
      licenseKey: lk.key,
      createdBy: lk.createdBy,
    })
    .returning();

  // Mark key as redeemed
  await db
    .update(licenseKeys)
    .set({
      redeemed: "true",
      redeemedBy: userId,
      redeemedAt: now,
    })
    .where(eq(licenseKeys.id, lk.id));

  return {
    id: license.id,
    slots: license.slots,
    durationDays: license.durationDays,
    durationHours: license.durationHours,
    expiresAt: license.expiresAt,
    active: true,
    reason: license.reason,
    licenseKey: license.licenseKey,
    createdAt: license.createdAt,
    isExpired: false,
    timeLeft: formatTimeLeft(license.expiresAt),
  };
}

/**
 * Get all license keys (admin)
 */
export async function getAllLicenseKeys(): Promise<LicenseKeyInfo[]> {
  const all = await db
    .select({
      key: licenseKeys,
      redeemer: users,
    })
    .from(licenseKeys)
    .leftJoin(users, eq(licenseKeys.redeemedBy, users.id))
    .orderBy(desc(licenseKeys.createdAt));

  return all.map(({ key, redeemer }) => ({
    id: key.id,
    key: key.key,
    slots: key.slots,
    durationDays: key.durationDays,
    durationHours: key.durationHours,
    reason: key.reason,
    active: key.active === "true",
    redeemed: key.redeemed === "true",
    redeemedBy: key.redeemedBy,
    redeemedByUsername: redeemer?.username || null,
    redeemedAt: key.redeemedAt,
    createdBy: key.createdBy,
    createdAt: key.createdAt,
  }));
}

/**
 * Revoke a license (set active = false)
 */
export async function revokeLicense(licenseId: string): Promise<void> {
  await db
    .update(licenses)
    .set({ active: "false" })
    .where(eq(licenses.id, licenseId));
}

/**
 * Delete a license
 */
export async function deleteLicense(licenseId: string): Promise<void> {
  await db.delete(licenses).where(eq(licenses.id, licenseId));
}

/**
 * Revoke a license key
 */
export async function revokeLicenseKey(keyId: string): Promise<void> {
  await db
    .update(licenseKeys)
    .set({ active: "false" })
    .where(eq(licenseKeys.id, keyId));
}

/**
 * Delete a license key
 */
export async function deleteLicenseKey(keyId: string): Promise<void> {
  await db.delete(licenseKeys).where(eq(licenseKeys.id, keyId));
}

/**
 * Check if user can create a bot (has available slots)
 */
export async function canUserCreateBot(userId: string): Promise<{ allowed: boolean; reason?: string; status: UserLicenseStatus }> {
  const status = await getUserLicenseStatus(userId);
  
  // Admins always allowed
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (user?.role === "admin") {
    return { allowed: true, status };
  }

  if (status.totalSlots === 0) {
    return {
      allowed: false,
      reason: "No active license. You have 0 bot slots. Go to License tab and redeem a key like abeam-key-xxxx.",
      status,
    };
  }

  if (status.availableSlots <= 0) {
    return {
      allowed: false,
      reason: `Slot limit reached: ${status.usedSlots}/${status.totalSlots} bots. Redeem another license key for more slots.`,
      status,
    };
  }

  return { allowed: true, status };
}

/**
 * Get all licenses (admin) - redeemed licenses
 */
export async function getAllLicenses(): Promise<(LicenseInfo & { username: string; userId: string })[]> {
  const all = await db
    .select({
      license: licenses,
      user: users,
    })
    .from(licenses)
    .leftJoin(users, eq(licenses.userId, users.id))
    .orderBy(desc(licenses.createdAt));

  const now = new Date();
  return all.map(({ license, user }) => {
    const isExpired = license.expiresAt <= now || license.active !== "true";
    return {
      id: license.id,
      userId: license.userId,
      username: user?.username || "Unknown",
      slots: license.slots,
      durationDays: license.durationDays,
      durationHours: license.durationHours,
      expiresAt: license.expiresAt,
      active: license.active === "true" && !isExpired,
      reason: license.reason,
      licenseKey: license.licenseKey,
      createdAt: license.createdAt,
      isExpired,
      timeLeft: formatTimeLeft(license.expiresAt),
    };
  });
}
