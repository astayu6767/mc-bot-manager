// AI text provider for beam conversations.
//
// Providers (tried in order, env-configured; defaults baked in per owner):
//   POLLINATIONS_API_KEYS  comma-separated keys (default: two baked-in keys)
//   POLLINATIONS_MODEL     default "MarcosFRG/deepseek-v4-pro"
//   OPENROUTER_API_KEY     fallback provider
//   AI_MODEL               openrouter model, default "nvidia/nemotron-3.5-lightning:free"
//   AI_PROVIDER            "pollinations" | "openrouter" | "auto" (default auto)

const POLLINATIONS_BASE = "https://gen.pollinations.ai/text";

const DEFAULT_POLLINATIONS_KEYS = [
  "sk_qbR3YL6rZwribqxDVJPQgvaqUKAUoqhw",
  "sk_rCHV415WKB5wPpxHe0fudPgBqe3noHa9",
];
const DEFAULT_OPENROUTER_KEY = "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";
const DEFAULT_POLLINATIONS_MODEL = "MarcosFRG/deepseek-v4-pro";
const DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3.5-lightning:free";

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
let lastPolError = "";
let lastOrError = "";

// Both provider error chains — never overwritten, so the console shows the
// FULL reason (e.g. pollinations rate-limit + openrouter key dead).
export function lastAiError(): string {
  return [lastPolError, lastOrError].filter(Boolean).join(" | ");
}

export function aiStatus(): { pollinations: boolean; openrouter: boolean } {
  return {
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

async function pollinationsText(prompt: string, timeoutMs: number): Promise<string | null> {
  const keys = pollinationsKeys();
  if (keys.length === 0) return null;
  const model = process.env.POLLINATIONS_MODEL || DEFAULT_POLLINATIONS_MODEL;
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

// Generate a short reply from a prompt. Pollinations first (sticky-key
// failover + one retry pass), then OpenRouter. provider is null when
// everything failed — check lastAiError() for the reason.
export async function aiText(prompt: string, timeoutMs = 18000): Promise<AiResult> {
  const started = Date.now();
  const prefer = (process.env.AI_PROVIDER || "auto").toLowerCase();
  const hasPol = pollinationsKeys().length > 0;
  const hasOr = Boolean((process.env.OPENROUTER_API_KEY || "").trim() || DEFAULT_OPENROUTER_KEY);

  const polFirst = prefer === "pollinations" || (prefer === "auto" && hasPol);
  if (polFirst && hasPol) {
    const t = await pollinationsText(prompt, timeoutMs);
    if (t) return { text: t, provider: "pollinations", ms: Date.now() - started };
  }
  if (hasOr && prefer !== "pollinations") {
    const t = await openRouterText(prompt, timeoutMs);
    if (t) return { text: t, provider: "openrouter", ms: Date.now() - started };
  }
  if (hasPol && !polFirst) {
    const t = await pollinationsText(prompt, timeoutMs);
    if (t) return { text: t, provider: "pollinations", ms: Date.now() - started };
  }
  return { text: null, provider: null, ms: Date.now() - started };
}
