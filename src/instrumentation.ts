// Next.js runs this once when the server process starts. We use it to
// reconnect all bots that were left enabled, so they survive restarts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { resumeEnabledBots } = await import("@/lib/botManager");
      // Small delay so the DB connection is ready.
      setTimeout(() => {
        void resumeEnabledBots();
      }, 1500);
    } catch {
      // ignore
    }
    // Auto-start the Discord admin bot if a token was saved in the admin panel.
    try {
      const { startSavedDiscordBot } = await import("@/server/discord/bot");
      setTimeout(() => {
        void startSavedDiscordBot();
      }, 2500);
    } catch {
      // ignore
    }
    // Retry-loop that sweeps paid invoices to the owner LTC wallet.
    try {
      const { startInvoiceSweeper } = await import("@/lib/ltcSweep");
      startInvoiceSweeper();
    } catch {
      // ignore
    }
  }
}
