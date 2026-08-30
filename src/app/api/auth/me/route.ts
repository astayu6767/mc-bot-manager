import { getCurrentUser, isDiscordConfigured } from "@/lib/auth";
import { db } from "@/db";
import { bots } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getUserLicenseStatus } from "@/lib/license";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({
      user: null,
      discordConfigured: isDiscordConfigured(),
    });
  }
  const owned = await db
    .select({ id: bots.id })
    .from(bots)
    .where(eq(bots.userId, user.id));
  
  const licenseStatus = await getUserLicenseStatus(user.id);
  
  return Response.json({
    user: {
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      role: user.role,
      botSlots: licenseStatus.totalSlots, // Use license total, not base
      botCount: owned.length,
      isGuest: user.discordId?.startsWith("dev:") ?? false,
      licenseStatus,
    },
    discordConfigured: isDiscordConfigured(),
  });
}
