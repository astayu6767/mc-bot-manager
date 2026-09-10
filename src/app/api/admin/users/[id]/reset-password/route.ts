import { randomBytes } from "crypto";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser, hashPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Readable charset — no lookalikes (0/O, 1/l/I) so the admin can read the
// one-time password over chat without ambiguity.
const PW_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

function generatePassword(len = 14): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += PW_CHARS[bytes[i] % PW_CHARS.length];
  return out;
}

// Reset a local (email + password) account's password. The old password stops
// working immediately; the new one is returned ONCE for the admin to hand over.
// Discord accounts have no password — those are rejected with a clear message.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  let body: { password?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — means "generate one for me"
  }

  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }
  if (!user.passwordHash) {
    return Response.json(
      { error: "This account signs in with Discord — there is no password to reset" },
      { status: 400 },
    );
  }

  const custom = (body.password ?? "").trim();
  if (custom && (custom.length < 8 || custom.length > 72)) {
    return Response.json(
      { error: "Custom password must be 8-72 characters" },
      { status: 400 },
    );
  }

  const password = custom || generatePassword();
  await db
    .update(users)
    .set({ passwordHash: hashPassword(password) })
    .where(eq(users.id, id));

  console.warn(
    `[admin] ${me.username} reset the password of "${user.username}"`,
  );

  return Response.json({ ok: true, username: user.username, password });
}
