import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

// Site-wide maintenance lock, stored in app_settings so it survives restarts.
// When ON: every bot is stopped and no bot can start until it's turned OFF.

const MAINTENANCE_KEY = "maintenance_mode";

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
