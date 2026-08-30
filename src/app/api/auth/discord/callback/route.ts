import { NextResponse } from "next/server";
import {
  isDiscordConfigured,
  attachSessionCookie,
  upsertDiscordUser,
} from "@/lib/auth";
import { publicOrigin } from "@/lib/origin";
import { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET } from "@/lib/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = publicOrigin(req);

  if (!isDiscordConfigured()) {
    return Response.redirect(`${origin}/?error=discord_not_configured`);
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return Response.redirect(`${origin}/?error=no_code`);
  }

  const redirectUri = `${origin}/api/auth/discord/callback`;

  try {
    // Exchange the code for an access token.
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("=== DISCORD TOKEN EXCHANGE FAILED ===");
      console.error("Status:", tokenRes.status);
      console.error("Response:", errText);
      console.error("Redirect URI sent:", redirectUri);
      return NextResponse.redirect(`${origin}/?error=token_exchange_failed`);
    }
    const tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) {
      return Response.redirect(`${origin}/?error=no_access_token`);
    }

    // Fetch the Discord user profile.
    const meRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!meRes.ok) {
      return Response.redirect(`${origin}/?error=profile_failed`);
    }
    const me = (await meRes.json()) as {
      id: string;
      username: string;
      global_name?: string;
      avatar: string | null;
    };

    const user = await upsertDiscordUser({
      discordId: me.id,
      username: me.global_name || me.username,
      handle: me.username,
      avatar: me.avatar
        ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png`
        : null,
    });

    const res = NextResponse.redirect(`${origin}/?login=success`);
    attachSessionCookie(res, user.id);
    return res;
  } catch (err) {
    console.error("=== OAUTH CALLBACK ERROR ===", err);
    return NextResponse.redirect(`${origin}/?error=oauth_error`);
  }
}
