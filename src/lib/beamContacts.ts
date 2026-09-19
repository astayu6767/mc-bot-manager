import { db } from "@/db";
import { beamAttempts, beamContacts, bots } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";

// Beam contact memory + funnel recording. All functions are fire-and-forget
// safe: callers wrap them so a DB hiccup can never kill a live conversation.

export type BeamContactRow = {
  username: string;
  host: string;
  outcome: string;
  attempts: number;
  lastSeenAt: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;
// declined players are remembered for 30 days; unanswered ones get one retry
// after a 5-day window (second no-reply = permanent skip for that player).
const DECLINE_MEMORY_DAYS = 30;
const RETRY_WINDOW_DAYS = 5;
const MAX_NO_REPLY_ATTEMPTS = 2;

/// Pure decision: given the contact row we have for this player+server,
/// should the bot skip them? Extracted so it can be unit-tested.
export function decideSkip(
  row: BeamContactRow | null,
  now = Date.now(),
): { skip: boolean; reason: string } {
  if (row) {
    const ageDays = (now - row.lastSeenAt.getTime()) / DAY_MS;
    if (row.outcome === "agreed") {
      return { skip: true, reason: "already converted" };
    }
    if (row.outcome === "declined") {
      if (ageDays < DECLINE_MEMORY_DAYS) {
        return {
          skip: true,
          reason: `declined ${Math.max(1, Math.floor(ageDays))}d ago`,
        };
      }
      return { skip: false, reason: "" };
    }
    if (row.outcome === "noreply" && row.attempts >= MAX_NO_REPLY_ATTEMPTS) {
      return { skip: true, reason: "never replies" };
    }
    // messaged / replied / first noreply: don't double-message inside the
    // retry window.
    if (ageDays < RETRY_WINDOW_DAYS) {
      return {
        skip: true,
        reason: `contacted ${Math.max(1, Math.floor(ageDays))}d ago (retry after ${RETRY_WINDOW_DAYS}d)`,
      };
    }
  }
  return { skip: false, reason: "" };
}

/// Full skip check for a target on a server, including the cross-server
/// "already converted" rule (same discord drop at the end → one pitch ever).
export async function shouldSkipTarget(
  username: string,
  host: string,
): Promise<{ skip: boolean; reason: string }> {
  try {
    const lc = username.toLowerCase();
    const [row] = await db
      .select()
      .from(beamContacts)
      .where(
        and(eq(beamContacts.username, lc), eq(beamContacts.host, host)),
      )
      .limit(1);
    const decision = decideSkip(
      row
        ? {
            username: row.username,
            host: row.host,
            outcome: row.outcome,
            attempts: row.attempts,
            lastSeenAt: row.lastSeenAt,
          }
        : null,
    );
    if (decision.skip) return decision;
    const [anyAgreed] = await db
      .select({ id: beamContacts.id })
      .from(beamContacts)
      .where(and(eq(beamContacts.username, lc), eq(beamContacts.outcome, "agreed")))
      .limit(1);
    if (anyAgreed) {
      return { skip: true, reason: "already converted (another server)" };
    }
    return { skip: false, reason: "" };
  } catch {
    // DB unavailable → beam normally rather than stalling matches
    return { skip: false, reason: "" };
  }
}

/// Upsert the contact row. "agreed" is terminal and never downgraded; the
/// attempt counter only grows on new "messaged" outreach.
export async function upsertContact(args: {
  username: string;
  host: string;
  outcome: string;
  method?: string;
  botId?: string;
}): Promise<void> {
  const lc = args.username.toLowerCase();
  await db
    .insert(beamContacts)
    .values({
      username: lc,
      host: args.host,
      outcome: args.outcome,
      attempts: args.outcome === "messaged" ? 1 : 0,
      method: args.method ?? "",
      botId: args.botId ?? "",
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [beamContacts.username, beamContacts.host],
      set: {
        outcome: sql`CASE WHEN ${beamContacts.outcome} = 'agreed' THEN 'agreed' ELSE excluded.outcome END`,
        attempts: sql`${beamContacts.attempts} + CASE WHEN excluded.outcome = 'messaged' THEN 1 ELSE 0 END`,
        method: sql`excluded.method`,
        botId: sql`excluded.bot_id`,
        lastSeenAt: sql`excluded.last_seen_at`,
      },
    });
}

/// One funnel event row.
export async function recordAttempt(args: {
  botId: string;
  host: string;
  username: string;
  method?: string;
  stage: string;
  note?: string;
}): Promise<void> {
  await db.insert(beamAttempts).values({
    botId: args.botId,
    host: args.host,
    username: args.username.toLowerCase(),
    method: args.method ?? "",
    stage: args.stage,
    note: (args.note ?? "").slice(0, 120),
  });
}

export type BeamStats = {
  totals: { messaged: number; replied: number; agreed: number; saidSent: number; skipped: number };
  servers: FunnelRow[];
  bots: (FunnelRow & { name: string })[];
  methods: FunnelRow[];
  daily: { day: string; messaged: number; replied: number; agreed: number }[];
  contacts: { total: number; agreed: number; declined: number; noreply: number };
};

export type FunnelRow = {
  key: string;
  messaged: number;
  replied: number;
  agreed: number;
  saidSent: number;
  replyPct: number;
  agreePct: number;
};

/// Aggregates the last 7 days of funnel events for the admin stats view.
export async function getBeamStats(): Promise<BeamStats> {
  const since = new Date(Date.now() - 7 * DAY_MS);
  const [rows, contactRows, botRows] = await Promise.all([
    db.select().from(beamAttempts).where(gte(beamAttempts.createdAt, since)),
    db.select().from(beamContacts),
    db.select({ id: bots.id, name: bots.name }).from(bots),
  ]);
  const botName = new Map(botRows.map((b) => [b.id, b.name]));

  const agg = (keyOf: (r: (typeof rows)[number]) => string): FunnelRow[] => {
    const m = new Map<string, FunnelRow>();
    for (const r of rows) {
      if (r.stage === "skipped_known") continue;
      const k = keyOf(r) || "(unknown)";
      let e = m.get(k);
      if (!e) {
        e = { key: k, messaged: 0, replied: 0, agreed: 0, saidSent: 0, replyPct: 0, agreePct: 0 };
        m.set(k, e);
      }
      if (r.stage === "messaged") e.messaged++;
      else if (r.stage === "replied") e.replied++;
      else if (r.stage === "agreed") e.agreed++;
      else if (r.stage === "said_sent") e.saidSent++;
    }
    const out = [...m.values()];
    for (const e of out) {
      e.replyPct = e.messaged ? Math.round((e.replied / e.messaged) * 100) : 0;
      e.agreePct = e.messaged ? Math.round((e.agreed / e.messaged) * 100) : 0;
    }
    return out.sort((a, b) => b.messaged - a.messaged);
  };

  const dailyMap = new Map<string, { day: string; messaged: number; replied: number; agreed: number }>();
  for (const r of rows) {
    const day = r.createdAt.toISOString().slice(0, 10);
    let e = dailyMap.get(day);
    if (!e) {
      e = { day, messaged: 0, replied: 0, agreed: 0 };
      dailyMap.set(day, e);
    }
    if (r.stage === "messaged") e.messaged++;
    else if (r.stage === "replied") e.replied++;
    else if (r.stage === "agreed") e.agreed++;
  }

  const totals = rows.reduce(
    (acc, r) => {
      if (r.stage === "messaged") acc.messaged++;
      else if (r.stage === "replied") acc.replied++;
      else if (r.stage === "agreed") acc.agreed++;
      else if (r.stage === "said_sent") acc.saidSent++;
      else if (r.stage === "skipped_known") acc.skipped++;
      return acc;
    },
    { messaged: 0, replied: 0, agreed: 0, saidSent: 0, skipped: 0 },
  );

  return {
    totals,
    servers: agg((r) => r.host),
    bots: agg((r) => r.botId).map((e) => ({ ...e, name: botName.get(e.key) ?? e.key })),
    methods: agg((r) => r.method),
    daily: [...dailyMap.values()].sort((a, b) => (a.day < b.day ? 1 : -1)),
    contacts: {
      total: contactRows.length,
      agreed: contactRows.filter((c) => c.outcome === "agreed").length,
      declined: contactRows.filter((c) => c.outcome === "declined").length,
      noreply: contactRows.filter((c) => c.outcome === "noreply").length,
    },
  };
}
