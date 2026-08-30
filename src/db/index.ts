import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
const databaseUrl = process.env.DATABASE_URL;
const effectiveUrl = databaseUrl || "postgres://build:build@localhost:5432/build_dummy";
const globalForDb = globalThis as typeof globalThis & { __arenaNextJsPostgresqlPool?: Pool; };
export const pool = globalForDb.__arenaNextJsPostgresqlPool ?? new Pool({ connectionString: effectiveUrl, connectionTimeoutMillis: 2000, idleTimeoutMillis: 1000, });
if (process.env.NODE_ENV !== "production") { globalForDb.__arenaNextJsPostgresqlPool = pool; }
export const db = drizzle(pool);
