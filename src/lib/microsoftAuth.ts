// Minecraft email:password login — the standard MSA -> Xbox -> Minecraft
// chain (same one the launcher uses), server-side only.
//
//   1. Microsoft (consumer) OAuth password grant  -> MSA access token
//   2. user.auth.xboxlive.com authenticate        -> Xbox Live token + uhs
//   3. xsts.auth.xboxlive.com authorize           -> XSTS token
//   4. api.minecraftservices.com login_with_xbox  -> Minecraft bearer token
//   5. api.minecraftservices.com minecraft/profile -> IGN + UUID
//
// The password is used once and thrown away — only the resulting bearer
// token (and profile) is returned to the caller.

const MS_TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const XBL_URL = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_URL = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN_URL = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile";

// Public client id used by the legacy Xbox/Minecraft auth apps (same one
// community launchers use for the password grant).
const CLIENT_ID = "00000000402b5328";

export type MinecraftLogin = {
  token: string;
  name: string;
  id: string;
};

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs = 15000,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      // some endpoints return empty bodies on error
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export async function loginMinecraftEmail(
  email: string,
  password: string,
): Promise<MinecraftLogin> {
  // 1. Microsoft password grant.
  const msa = await fetchJson(MS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: CLIENT_ID,
      scope: "xboxlive.signin offline_access",
      username: email,
      password,
    }).toString(),
  });
  if (msa.status === 400 || msa.status === 401) {
    throw new Error(
      "Incorrect email or password — or the account has 2FA enabled (use the session ID method instead)",
    );
  }
  const msaToken = (msa.body.access_token as string) || "";
  if (msa.status !== 200 || !msaToken) {
    throw new Error("Microsoft login failed — try again in a moment");
  }

  // 2. Xbox Live authenticate.
  const xbl = await fetchJson(XBL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      Properties: {
        AuthMethod: "RPS",
        SiteName: "user.auth.xboxlive.com",
        RpsTicket: `d=${msaToken}`,
      },
      RelyingParty: "http://auth.xboxlive.com",
      TokenType: "JWT",
    }),
  });
  const xblToken = (xbl.body.Token as string) || "";
  const xblUhs =
    ((xbl.body.DisplayClaims as { xui?: { uhs?: string }[] } | undefined)?.xui?.[0]?.uhs as
      | string
      | undefined) || "";
  if (xbl.status !== 200 || !xblToken || !xblUhs) {
    throw new Error("Xbox authentication failed");
  }

  // 3. XSTS authorize.
  const xsts = await fetchJson(XSTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      Properties: {
        SandboxId: "RETAIL",
        UserTokens: [xblToken],
      },
      RelyingParty: "rp://api.minecraftservices.com/",
      TokenType: "JWT",
    }),
  });
  const xstsToken = (xsts.body.Token as string) || "";
  const xstsUhs =
    ((xsts.body.DisplayClaims as { xui?: { uhs?: string }[] } | undefined)?.xui?.[0]?.uhs as
      | string
      | undefined) || "";
  if (xsts.status !== 200 || !xstsToken || !xstsUhs) {
    // Standard XSTS error codes.
    const code = (xsts.body.XErr as number) || 0;
    if (code === 2148916233) throw new Error("This Microsoft account has no Xbox profile");
    if (code === 2148916238) throw new Error("This is a child account — sign in on minecraft.net first");
    throw new Error("Xbox XSTS authorization failed");
  }

  // 4. Minecraft services login.
  const mc = await fetchJson(MC_LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identityToken: `XBL3.0 x=${xstsUhs};${xstsToken}`,
    }),
  });
  const mcToken = (mc.body.access_token as string) || "";
  if (mc.status !== 200 || !mcToken) {
    throw new Error("Minecraft login failed — the account may not own Minecraft");
  }

  // 5. Profile.
  const prof = await fetchJson(MC_PROFILE_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${mcToken}` },
  });
  const name = (prof.body.name as string) || "";
  const id = (prof.body.id as string) || "";
  if (prof.status !== 200 || !name || !id) {
    throw new Error("This account doesn't have a Minecraft profile");
  }

  return { token: mcToken, name, id };
}
