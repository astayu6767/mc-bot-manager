import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

// During build (next build), DATABASE_URL may not be set.
// We allow a dummy URL so that type checking and page data collection don't crash.
// Actual DB queries will fail gracefully at runtime if URL is still missing.
const effectiveUrl =
  databaseUrl || "postgres://build:build@localhost:5432/build_dummy";

if (!databaseUrl) {
  // Only warn, don't throw during build
  if (process.env.NODE_ENV === "production" && !process.env.NEXT_PHASE) {
    console.warn(
      "⚠️  DATABASE_URL is not set - using dummy URL for build. Set it at runtime.",
    );
  }
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: effectiveUrl,
    // Don't fail fast during build
    connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 1000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
