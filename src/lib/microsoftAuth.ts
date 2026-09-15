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

// Personal Microsoft accounts (live.com) authenticate at the LEGACY endpoint
// with the Xbox scope — the v2 endpoint rejects the password grant for MSA
// ("Incorrect email or password" even with valid credentials). The v2
// endpoint stays as a fallback for the rare account that prefers it.
const MS_TOKEN_URL = "https://login.live.com/oauth20_token.srf";
const MS_TOKEN_URL_V2 = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
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

// Password grant against the legacy MSA endpoint. Returns the access token
// plus which RpsTicket format it needs: tokens from login.live.com are used
// PLAIN, v2-endpoint tokens take the "d=" prefix (both verified against the
// community-documented chains).
async function msaPasswordToken(
  email: string,
  password: string,
): Promise<{ token: string; ticketPrefix: string }> {
  const attempts: Array<{ url: string; scope: string; ticketPrefix: string }> = [
    {
      url: MS_TOKEN_URL,
      scope: "service::user.auth.xboxlive.com::MBI_SSL",
      ticketPrefix: "",
    },
    {
      url: MS_TOKEN_URL_V2,
      scope: "xboxlive.signin",
      ticketPrefix: "d=",
    },
  ];

  let lastErr = "";
  for (const a of attempts) {
    const msa = await fetchJson(a.url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: CLIENT_ID,
        scope: a.scope,
        username: email,
        password,
      }).toString(),
    });
    const token = (msa.body.access_token as string) || "";
    if (msa.status === 200 && token) {
      return { token, ticketPrefix: a.ticketPrefix };
    }
    const errCode = String(msa.body.error ?? "");
    const errDesc = String(msa.body.error_description ?? "").slice(0, 200);
    lastErr = `${a.url} -> HTTP ${msa.status} ${errCode} ${errDesc}`;
    console.warn(`[mc-login] ${lastErr}`);
    // Hard credential failure — no point trying the second endpoint.
    if (errCode === "invalid_grant" && /password|credentials/i.test(errDesc)) break;
  }

  const badCreds = /invalid_grant/i.test(lastErr);
  throw new Error(
    badCreds
      ? "Incorrect email or password — or the account uses 2FA / passwordless login (use the session ID method instead)"
      : "Microsoft login failed — try again in a moment",
  );
}

export async function loginMinecraftEmail(
  email: string,
  password: string,
): Promise<MinecraftLogin> {
  // 1. Microsoft password grant (legacy live.com endpoint first).
  const msa = await msaPasswordToken(email, password);
  const msaToken = msa.token;

  // 2. Xbox Live authenticate. The two token flavors need different
  //    RpsTicket formats — try the documented one first, then the other.
  let xbl: { status: number; body: Record<string, unknown> } | null = null;
  for (const prefix of [msa.ticketPrefix, msa.ticketPrefix === "" ? "d=" : ""]) {
    const attempt = await fetchJson(XBL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        Properties: {
          AuthMethod: "RPS",
          SiteName: "user.auth.xboxlive.com",
          RpsTicket: `${prefix}${msaToken}`,
        },
        RelyingParty: "http://auth.xboxlive.com",
        TokenType: "JWT",
      }),
    });
    if (attempt.status === 200 && attempt.body.Token) {
      xbl = attempt;
      break;
    }
    console.warn(`[mc-login] XBL failed (prefix ${JSON.stringify(prefix)}): HTTP ${attempt.status}`);
  }
  if (!xbl) {
    throw new Error("Xbox authentication failed");
  }
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
