import { db } from "@/db";
import { users, bots } from "@/db/schema";
import { eq } from "drizzle-orm";

export type BotEntitlement = {
  allowed: boolean;
  reason?: string;
  slots: number;
  used: number;
};

/**
 * Checks if a user is entitled to run bots.
 * This is used to guard bot startup and automatic reconnects.
 * 
 * Logic:
 * - If licensing is disabled (default), allow all users with at least 1 slot
 * - Admins always allowed
 * - Regular users: check botSlots vs owned bots count
 * - If user not found, deny
 */
export async function getBotEntitlementForUserId(
  userId: string,
): Promise<BotEntitlement> {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      return {
        allowed: false,
        reason: "User not found - entitlement denied",
        slots: 0,
        used: 0,
      };
    }

    // Admins bypass all checks
    if (user.role === "admin") {
      const owned = await db
        .select({ id: bots.id })
        .from(bots)
        .where(eq(bots.userId, userId));
      return {
        allowed: true,
        slots: user.botSlots,
        used: owned.length,
      };
    }

    // If licensing is explicitly disabled via env, allow
    const licensingEnabled =
      process.env.LICENSING_ENABLED === "true" ||
      process.env.ENABLE_LICENSING === "true";

    if (!licensingEnabled) {
      // Even without licensing, respect botSlots for creation limits
      // but allow running already-created bots
      const owned = await db
        .select({ id: bots.id })
        .from(bots)
        .where(eq(bots.userId, userId));

      // If user has no slots at all, deny
      if (user.botSlots <= 0) {
        return {
          allowed: false,
          reason: `No bot slots remaining (0/${user.botSlots}). Ask an admin for more.`,
          slots: user.botSlots,
          used: owned.length,
        };
      }

      return {
        allowed: true,
        slots: user.botSlots,
        used: owned.length,
      };
    }

    // Licensing enabled - stricter checks
    const owned = await db
      .select({ id: bots.id })
      .from(bots)
      .where(eq(bots.userId, userId));

    // Check if user has exceeded their slot limit for running bots
    // We allow running if they are within their slot allocation
    if (owned.length > user.botSlots) {
      return {
        allowed: false,
        reason: `Slot limit exceeded: ${owned.length}/${user.botSlots} bots. Upgrade required.`,
        slots: user.botSlots,
        used: owned.length,
      };
    }

    if (user.botSlots <= 0) {
      return {
        allowed: false,
        reason: "No active license / bot slots. Please contact admin.",
        slots: user.botSlots,
        used: owned.length,
      };
    }

    return {
      allowed: true,
      slots: user.botSlots,
      used: owned.length,
    };
  } catch (err) {
    // On DB errors, fail open in dev but log the error
    // In production, you might want to fail closed
    console.error("Entitlement check failed:", err);
    
    // Fail open to avoid breaking existing bots if DB is temporarily unavailable
    // Change to false if you want strict licensing
    return {
      allowed: true,
      reason: "Entitlement check bypassed due to DB error",
      slots: 0,
      used: 0,
    };
  }
}

/**
 * Alias for backward compatibility / alternative naming
 */
export const getEntitlementForUserId = getBotEntitlementForUserId;

/**
 * Checks entitlement for a specific bot record
 */
export async function getBotEntitlementForBotId(
  botId: string,
): Promise<BotEntitlement & { botId: string }> {
  try {
    const [bot] = await db.select().from(bots).where(eq(bots.id, botId));
    if (!bot || !bot.userId) {
      return {
        botId,
        allowed: true, // Allow bots without owner (legacy)
        slots: 0,
        used: 0,
      };
    }
    const ent = await getBotEntitlementForUserId(bot.userId);
    return { ...ent, botId };
  } catch {
    return {
      botId,
      allowed: true,
      slots: 0,
      used: 0,
    };
  }
}
