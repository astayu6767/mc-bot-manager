/**
 * Azalea Engine - Stub / Future Rust Integration
 * 
 * This file is intentionally kept free of filesystem operations at the top level
 * to avoid Turbopack's "Encountered unexpected file in NFT list" warnings.
 * 
 * The original error was:
 * - next.config.ts -> azaleaEngine.ts -> botManager.ts -> stop route
 * - Caused by path.join/process.cwd/fs.readFile at module scope
 * 
 * If you need to implement Azalea (Rust Minecraft bot), do:
 * 1. Keep all fs/path operations inside functions, not at top level
 * 2. Use dynamic imports
 * 3. Mark as server-only
 */

import type { Bot } from "@/db/schema";

// Server-only marker - ensures this module is never bundled for client
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type AzaleaBotOptions = {
  botId: string;
  host: string;
  port: number;
  username?: string;
  token: string;
  version?: string;
};

export type AzaleaRuntime = {
  id: string;
  status: "offline" | "connecting" | "online" | "error";
  process?: unknown;
};

// In-memory runtimes for Azalea bots (separate from mineflayer runtimes)
const azaleaRuntimes = new Map<string, AzaleaRuntime>();

function getAzaleaRuntime(id: string): AzaleaRuntime {
  let rt = azaleaRuntimes.get(id);
  if (!rt) {
    rt = { id, status: "offline" };
    azaleaRuntimes.set(id, rt);
  }
  return rt;
}

/**
 * Start an Azalea bot (Rust-based)
 * Currently a stub that falls back to explaining the setup needed.
 * 
 * To implement real Azalea:
 * - Build Rust binary via cargo (see Dockerfile)
 * - Spawn child_process with bot credentials
 * - Pipe logs
 */
export async function startAzaleaBot(record: Bot): Promise<void> {
  const rt = getAzaleaRuntime(record.id);
  rt.status = "connecting";

  // Check if Azalea binary exists (inside function, not top-level)
  // This avoids Turbopack tracing the whole filesystem
  try {
    // Dynamic import to avoid top-level fs
    const { spawn } = await import("child_process");
    const { existsSync } = await import("fs");
    
    // Look for binary in known locations - scoped to subfolder to avoid NFT warning
    const possiblePaths = [
      "./azalea-bot", // local binary
      "./target/release/azalea-bot",
      "/app/azalea-bot",
      "/app/target/release/azalea-bot",
    ];

    let binaryPath: string | null = null;
    for (const p of possiblePaths) {
      try {
        if (existsSync(p)) {
          binaryPath = p;
          break;
        }
      } catch {
        // ignore
      }
    }

    if (!binaryPath) {
      // No binary - log and fallback
      // In production, you would build the Rust binary in Dockerfile:
      // RUN cargo build --release
      throw new Error(
        "Azalea binary not found. Build it with 'cargo build --release' or use mineflayer/nmp engine.",
      );
    }

    // If binary exists, spawn it (example)
    // const child = spawn(binaryPath, [record.host, String(record.port), record.token], {...})
    // rt.process = child
    // rt.status = "online"

    rt.status = "error";
    throw new Error("Azalea engine stub - binary found but integration not completed");
  } catch (err) {
    rt.status = "error";
    const msg = err instanceof Error ? err.message : String(err);
    // Don't throw - let caller handle via logs
    console.error(`[Azalea] Failed to start bot ${record.id}:`, msg);
    throw err;
  }
}

export async function stopAzaleaBot(id: string): Promise<void> {
  const rt = azaleaRuntimes.get(id);
  if (rt) {
    rt.status = "offline";
    if (rt.process) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const proc = rt.process as any;
        if (typeof proc.kill === "function") proc.kill();
      } catch {
        // ignore
      }
      rt.process = undefined;
    }
  }
  azaleaRuntimes.delete(id);
}

export function getAzaleaRuntimeView(id: string) {
  const rt = azaleaRuntimes.get(id);
  if (!rt) return { status: "offline" as const, joined: false };
  return {
    status: rt.status,
    joined: rt.status === "online",
  };
}

// Re-export for compatibility if botManager wants to use Azalea
export const azaleaEngine = {
  start: startAzaleaBot,
  stop: stopAzaleaBot,
  getRuntime: getAzaleaRuntimeView,
};
