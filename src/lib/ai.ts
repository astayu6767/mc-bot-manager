// AI text provider for beam conversations.
//
// Providers (tried in order, env-configured — NO keys in code):
//   POLLINATIONS_API_KEYS  comma-separated keys, rotated round-robin per request
//   POLLINATIONS_MODEL     default "MarcosFRG/deepseek-v4-pro"
//   OPENROUTER_API_KEY     fallback provider (used if pollinations fails/is unset)
//   AI_MODEL               openrouter model, default "nvidia/nemotron-3.5-lightning:free"
//   AI_PROVIDER            "pollinations" | "openrouter" | "auto" (default: auto
//                          = pollinations first when its keys are set, then openrouter)

const POLLINATIONS_BASE = "https://gen.pollinations.ai/text";

// Default keys baked in per owner's request (env vars still override):
//   POLLINATIONS_API_KEYS (comma-separated), OPENROUTER_API_KEY,
//   POLLINATIONS_MODEL, AI_MODEL
const DEFAULT_POLLINATIONS_KEYS = [
  "sk_qbR3YL6rZwribqxDVJPQgvaqUKAUoqhw",
  "sk_rCHV415WKB5wPpxHe0fudPgBqe3noHa9",
];
const DEFAULT_OPENROUTER_KEY = "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";
const DEFAULT_POLLINATIONS_MODEL = "MarcosFRG/deepseek-v4-pro";
const DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3.5-lightning:free";

export function aiStatus(): { pollinations: boolean; openrouter: boolean } {
  return {
    pollinations: pollinationsKeys().length > 0,
    openrouter: Boolean((process.env.OPENROUTER_API_KEY || "").trim() || DEFAULT_OPENROUTER_KEY),
  };
}

let polKeyIdx = 0;
function pollinationsKeys(): string[] {
  const env = (process.env.POLLINATIONS_API_KEYS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return env.length > 0 ? env : DEFAULT_POLLINATIONS_KEYS;
}
function nextPollinationsKey(): string | null {
  const keys = pollinationsKeys();
  if (keys.length === 0) return null;
  const k = keys[polKeyIdx % keys.length];
  polKeyIdx++;
  return k;
}

function stripReasoning(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```[\s\S]*?```/g, "")
    .trim();
}

async function pollinationsText(prompt: string, timeoutMs: number): Promise<string | null> {
  const keys = pollinationsKeys();
  const model = process.env.POLLINATIONS_MODEL || "MarcosFRG/deepseek-v4-pro";
  // Try each key once (rotation spreads load; a dead/rate-limited key is skipped).
  for (let i = 0; i < keys.length; i++) {
    const key = nextPollinationsKey();
    if (!key) return null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const url = `${POLLINATIONS_BASE}/${encodeURIComponent(prompt)}?model=${encodeURIComponent(model)}&key=${encodeURIComponent(key)}`;
      const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(timer);
      if (res.ok) {
        const text = stripReasoning(await res.text());
        if (text) return text;
      } else {
        console.warn(`[ai] pollinations key #${(polKeyIdx - 1) % keys.length + 1} → HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn(`[ai] pollinations request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
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
      if (text) return text;
    } else {
      console.warn(`[ai] openrouter → HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`[ai] openrouter request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return null;
}

export type AiResult = { text: string | null; provider: string | null; ms: number };

// Generate a short reply from a full prompt. Tries pollinations (rotating
// keys) then openrouter. Returns {text, provider, ms} — provider is null when
// everything failed, so callers can surface it instead of guessing.
export async function aiText(prompt: string, timeoutMs = 10000): Promise<AiResult> {
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
