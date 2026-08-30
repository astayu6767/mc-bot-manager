# Deploy MC Bot Manager to Railway (~5 minutes)

The repo is deploy-ready: `Dockerfile`, `railway.json` (healthcheck + startup),
and a `start.sh` that waits for Postgres and pushes the schema automatically.
**Discord client ID/secret, session secret and admin usernames are already
baked into `src/lib/config.ts`** (env vars override them if you ever want).

> ⚠️ Use the branch **`arena/01a04ee5-mc-bot-manager`** — it contains Azalea
> (Rust client) plus the GUI/engine picker. First Docker build compiles Azalea
> and can take 10–20 minutes.

## Steps

1. **railway.app** → log in → **New Project** → **Deploy from GitHub repo**.
   - If asked, install the Railway GitHub App and grant access to
     `Lexxxy123/mc-bot-manager`.
   - Select the repo, and when the service is created open
     **Settings → Source → Branch** and set it to
     `arena/01a04ee5-mc-bot-manager`.
2. In the project: **+ New → Database → Add PostgreSQL**.
3. Make sure the web service can see the DB URL (most new projects share it
   automatically as `DATABASE_URL`). If the deploy log says
   `DATABASE_URL is not set`:
   **web service → Variables → New Variable → Add Reference →** pick the
   PostgreSQL **`DATABASE_URL`**.
4. Wait for the build (first build **10–20 min** because it compiles the
   Azalea Rust sidecar). Then:
   **web service → Settings → Networking → Generate Domain**.
5. Copy your domain, e.g. `https://mc-bot-manager.up.railway.app`, and in the
   [Discord Developer Portal](https://discord.com/developers/applications) →
   your app → **OAuth2 → Redirects** add:

   ```
   https://YOUR-DOMAIN.up.railway.app/api/auth/discord/callback
   ```

6. Open your domain → **Continue with Discord** → done. First login = admin.

## Notes

- `/api/health` is the healthcheck endpoint.
- Env vars you can optionally set (all have defaults):
  `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`,
  `ADMIN_USERNAMES`, `ADMIN_DISCORD_ID`, `PUBLIC_BASE_URL`.
- Keep the service on an always-on plan — that's what keeps the Minecraft
  bots connected.
