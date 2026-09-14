import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

// Site-wide toggles, stored in app_settings so they survive restarts.
//
// Maintenance: when ON, every bot is stopped and no bot can start until
// it's turned OFF.
//
// AI mode: when OFF, the 1v1 Player Method (AI beam) is disabled — existing
// AI bots switch to lobby adbot mode and new AI bots can't be created until
// it's turned back ON.

const MAINTENANCE_KEY = "maintenance_mode";
const AI_MODE_KEY = "ai_mode";

export async function isMaintenanceOn(): Promise<boolean> {
  try {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, MAINTENANCE_KEY));
    return row?.value === "on";
  } catch {
    // Fail open — a DB hiccup must not brick every bot start.
    return false;
  }
}

export async function setMaintenance(on: boolean): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: MAINTENANCE_KEY, value: on ? "on" : "off" })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: on ? "on" : "off", updatedAt: new Date() },
    });
}

// AI mode (1v1 Player Method). Defaults to ENABLED — only the explicit
// "off" value disables it, so a missing row behaves like normal operation.
export async function isAiModeEnabled(): Promise<boolean> {
  try {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, AI_MODE_KEY));
    return row?.value !== "off";
  } catch {
    // Fail open — a DB hiccup must not silently kill the AI mode.
    return true;
  }
}

export async function setAiModeEnabled(enabled: boolean): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: AI_MODE_KEY, value: enabled ? "on" : "off" })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: enabled ? "on" : "off", updatedAt: new Date() },
    });
}
