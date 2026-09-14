// AI text provider for beam conversations.
//
// Providers (tried in order, env-configured; defaults baked in per owner):
//   TOKENHARBOR_API_KEY     primary provider (default: baked-in live key)
//   TOKENHARBOR_MODEL       default "deepseek-v4-flash:free"
//   POLLINATIONS_API_KEYS   comma-separated keys (default: two baked-in keys)
//   POLLINATIONS_MODEL      default "deepseek-pro"
//   OPENROUTER_API_KEY      last-resort provider
//   AI_MODEL                openrouter model, default "nvidia/nemotron-3.5-lightning:free"
//   AI_PROVIDER             "tokenharbour" | "pollinations" | "openrouter" | "auto" (default auto)

const TOKENHARBOR_BASE = "https://tokenharbor.ai/v1/chat/completions";
const POLLINATIONS_BASE = "https://gen.pollinations.ai/text";

// Live-verified key (owner-tested: deepseek-v4-flash:free returns instantly).
const DEFAULT_TOKENHARBOR_KEY = "thk_live_VUUcmiBvdk3XL_6OlpdSefgAsFixmRfJEGYNVztN1Ypsd8T6KAsSA67SC-SxWbDd";
const DEFAULT_TOKENHARBOR_MODEL = "deepseek-v4-flash:free";
const DEFAULT_POLLINATIONS_KEYS = [
  "sk_qbR3YL6rZwribqxDVJPQgvaqUKAUoqhw",
  "sk_rCHV415WKB5wPpxHe0fudPgBqe3noHa9",
];
const DEFAULT_OPENROUTER_KEY = "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";
// "deepseek-pro" is live-verified fast/reliable on both keys; the earlier
// default (MarcosFRG/deepseek-v4-pro) hangs for tens of seconds or 500s
// intermittently — that caused the "This operation was aborted" cascade.
const DEFAULT_POLLINATIONS_MODEL = "deepseek-pro";
const DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3.5-lightning:free";

function tokenHarbourKey(): string {
  return (process.env.TOKENHARBOR_API_KEY || "").trim() || DEFAULT_TOKENHARBOR_KEY;
}

function pollinationsKeys(): string[] {
  const env = (process.env.POLLINATIONS_API_KEYS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return env.length > 0 ? env : DEFAULT_POLLINATIONS_KEYS;
}

// Sticky key = index of the key that last WORKED. Free-tier keys get rate
// limited at random; preferring the healthy one halves the failure surface.
let stickyKeyIdx = 0;
let lastThError = "";
let lastPolError = "";
let lastOrError = "";

// All provider error chains — never overwritten, so the console shows the
// FULL reason (e.g. tokenharbour model unknown + pollinations rate-limit).
export function lastAiError(): string {
  return [lastThError, lastPolError, lastOrError].filter(Boolean).join(" | ");
}

export function aiStatus(): {
  tokenharbour: boolean;
  pollinations: boolean;
  openrouter: boolean;
} {
  return {
    tokenharbour: Boolean(tokenHarbourKey()),
    pollinations: pollinationsKeys().length > 0,
    openrouter: Boolean((process.env.OPENROUTER_API_KEY || "").trim() || DEFAULT_OPENROUTER_KEY),
  };
}

// Clean a raw model reply: drop reasoning, unwrap code fences (instead of
// discarding them), extract JSON message fields, strip surrounding quotes.
function stripReasoning(raw: string): string {
  let t = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
  const fence = t.match(/```[a-zA-Z]*\n?([\s\S]*?)```/);
  if (fence && fence[1].trim()) t = fence[1].trim();
  if (t.startsWith("{") && t.endsWith("}")) {
    try {
      const o = JSON.parse(t);
      const inner = o.reply ?? o.message ?? o.text ?? o.response;
      if (typeof inner === "string" && inner.trim()) t = inner.trim();
    } catch {
      // not JSON — keep as-is
    }
  }
  return t.replace(/^["'`]+|["'`]+$/g, "").trim();
}

// TokenHarbour — OpenAI-compatible chat completions endpoint. Primary
// provider. Body mirrors the owner-verified curl EXACTLY (model +
// messages only — no extra params; free models can 400 on them).
// provider. Single attempt with a tight cap: if the free model is cold or
// the key/model is misconfigured, the beam falls through to pollinations
// fast instead of burning the whole turn budget.
async function tokenHarbourText(prompt: string, timeoutMs: number): Promise<string | null> {
  const key = tokenHarbourKey();
  if (!key) return null;
  const model = process.env.TOKENHARBOR_MODEL || DEFAULT_TOKENHARBOR_MODEL;
  timeoutMs = Math.min(timeoutMs, 14000);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(TOKENHARBOR_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const json = await res.json();
      const raw = json?.choices?.[0]?.message?.content || "";
      const text = stripReasoning(String(raw));
      if (text) {
        lastThError = "";
        return text;
      }
      lastThError = "tokenharbour: empty reply";
      console.warn(`[ai] ${lastThError}`);
    } else {
      const body = (await res.text()).slice(0, 80).replace(/\s+/g, " ");
      lastThError = `tokenharbour: HTTP ${res.status}${body ? ` (${body})` : ""}`.slice(0, 250);
      console.warn(`[ai] ${lastThError}`);
    }
  } catch (err) {
    lastThError = `tokenharbour: ${err instanceof Error ? err.message : String(err)}`.slice(0, 250);
    console.warn(`[ai] ${lastThError}`);
  }
  return null;
}

async function pollinationsText(prompt: string, timeoutMs: number): Promise<string | null> {
  const keys = pollinationsKeys();
  if (keys.length === 0) return null;
  const model = process.env.POLLINATIONS_MODEL || DEFAULT_POLLINATIONS_MODEL;
  // per-attempt cap: 4 attempts + breather must stay well under a chat turn
  timeoutMs = Math.min(timeoutMs, 7000);
  const errors: string[] = [];
  // Two passes with a short breather — the free endpoint is flaky (rate
  // limits / cold starts); a single 5xx must not kill the turn.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < keys.length; i++) {
      const idx = (stickyKeyIdx + i) % keys.length;
      const key = keys[idx];
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        const url = `${POLLINATIONS_BASE}/${encodeURIComponent(prompt)}?model=${encodeURIComponent(model)}&key=${encodeURIComponent(key)}`;
        const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
        clearTimeout(timer);
        if (res.ok) {
          const text = stripReasoning(await res.text());
          if (text) {
            stickyKeyIdx = idx;
            lastPolError = "";
            return text;
          }
          errors.push(`key#${idx + 1} empty reply`);
        } else {
          const body = (await res.text()).slice(0, 80).replace(/\s+/g, " ");
          errors.push(`key#${idx + 1} HTTP ${res.status}${body ? ` (${body})` : ""}`);
        }
      } catch (err) {
        errors.push(`key#${idx + 1} ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (pass === 0) await new Promise((r) => setTimeout(r, 600));
  }
  lastPolError = `pollinations: ${errors.join("; ")}`.slice(0, 300);
  console.warn(`[ai] ${lastPolError}`);
  return null;
}

async function openRouterText(prompt: string, timeoutMs: number): Promise<string | null> {
  const key = (process.env.OPENROUTER_API_KEY || "").trim() || DEFAULT_OPENROUTER_KEY;
  if (!key) return null;
  const model = process.env.AI_MODEL || DEFAULT_OPENROUTER_MODEL;
  timeoutMs = Math.min(timeoutMs, 12000);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 120,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const json = await res.json();
      const raw = json?.choices?.[0]?.message?.content || "";
      const text = stripReasoning(String(raw));
      if (text) {
        lastOrError = "";
        return text;
      }
      lastOrError = "openrouter: empty reply";
      console.warn(`[ai] ${lastOrError}`);
    } else {
      const body = (await res.text()).slice(0, 80).replace(/\s+/g, " ");
      lastOrError = `openrouter: HTTP ${res.status}${body ? ` (${body})` : ""}`.slice(0, 250);
      console.warn(`[ai] ${lastOrError}`);
    }
  } catch (err) {
    lastOrError = `openrouter: ${err instanceof Error ? err.message : String(err)}`.slice(0, 250);
    console.warn(`[ai] ${lastOrError}`);
  }
  return null;
}

export type AiResult = { text: string | null; provider: string | null; ms: number };

// Generate a short reply from a prompt. Provider order (default auto):
// tokenharbour → pollinations (sticky-key failover + retry pass) →
// openrouter. provider is null when everything failed — check
// lastAiError() for the reason.
export async function aiText(prompt: string, timeoutMs = 18000): Promise<AiResult> {
  const started = Date.now();
  const prefer = (process.env.AI_PROVIDER || "auto").toLowerCase();
  const hasTh = Boolean(tokenHarbourKey());
  const hasPol = pollinationsKeys().length > 0;
  const hasOr = Boolean((process.env.OPENROUTER_API_KEY || "").trim() || DEFAULT_OPENROUTER_KEY);

  type Provider = "tokenharbour" | "pollinations" | "openrouter";
  let order: Provider[];
  if (prefer === "tokenharbour") order = ["tokenharbour", "pollinations", "openrouter"];
  else if (prefer === "pollinations") order = ["pollinations", "tokenharbour", "openrouter"];
  else if (prefer === "openrouter") order = ["openrouter", "tokenharbour", "pollinations"];
  else order = ["tokenharbour", "pollinations", "openrouter"]; // auto — tokenharbour is primary

  for (const p of order) {
    if (p === "tokenharbour" && hasTh) {
      const t = await tokenHarbourText(prompt, timeoutMs);
      if (t) return { text: t, provider: "tokenharbour", ms: Date.now() - started };
    } else if (p === "pollinations" && hasPol) {
      const t = await pollinationsText(prompt, timeoutMs);
      if (t) return { text: t, provider: "pollinations", ms: Date.now() - started };
    } else if (p === "openrouter" && hasOr) {
      const t = await openRouterText(prompt, timeoutMs);
      if (t) return { text: t, provider: "openrouter", ms: Date.now() - started };
    }
  }
  return { text: null, provider: null, ms: Date.now() - started };
}

// --- Admin "Test AI" panel: probe one provider directly ---

export type TestableProvider = "tokenharbour" | "pollinations" | "openrouter";

// What the admin panel shows per provider (effective model incl. env override).
export function aiTestInfo(): { id: TestableProvider; label: string; model: string }[] {
  return [
    {
      id: "tokenharbour",
      label: "TokenHarbour",
      model: process.env.TOKENHARBOR_MODEL || DEFAULT_TOKENHARBOR_MODEL,
    },
    {
      id: "pollinations",
      label: "Pollinations",
      model: process.env.POLLINATIONS_MODEL || DEFAULT_POLLINATIONS_MODEL,
    },
    {
      id: "openrouter",
      label: "OpenRouter",
      model: process.env.AI_MODEL || DEFAULT_OPENROUTER_MODEL,
    },
  ];
}

// Send a plain hello to EXACTLY one provider — no fallback chain — so the
// panel proves which provider is live and surfaces the raw failure reason.
export async function aiTestProvider(
  provider: TestableProvider,
  timeoutMs = 30000,
): Promise<{ text: string | null; ms: number; error: string | null }> {
  const prompt = "Say hello in one sentence.";
  const started = Date.now();
  if (provider === "tokenharbour") {
    lastThError = "";
    const text = await tokenHarbourText(prompt, timeoutMs);
    return {
      text,
      ms: Date.now() - started,
      error: text ? null : lastThError || "tokenharbour: no reply",
    };
  }
  if (provider === "pollinations") {
    lastPolError = "";
    const text = await pollinationsText(prompt, timeoutMs);
    return {
      text,
      ms: Date.now() - started,
      error: text ? null : lastPolError || "pollinations: no reply",
    };
  }
  if (provider === "openrouter") {
    lastOrError = "";
    const text = await openRouterText(prompt, timeoutMs);
    return {
      text,
      ms: Date.now() - started,
      error: text ? null : lastOrError || "openrouter: no reply",
    };
  }
  return { text: null, ms: 0, error: "unknown provider" };
}
