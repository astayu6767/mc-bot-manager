# World-switch simulator

Proves how mineflayer / Raw NMP (minecraft-protocol) behave through a
Minemen-style arena transfer, versus the azalea engine's ECS wedge.

## What it simulates

`eu.minemen.club` is a BungeeCord network: joining a duel transfers you to a
backend server **on the same TCP socket**, which means the client receives a
**second `login` packet** mid-session (and often a `respawn` dimension change).
This harness reproduces that locally:

- `server.js` — fake "Minemen" on `127.0.0.1:25577` (1.20.1, offline). Streams
  chat every 300ms. At t=3s writes a 2nd `login` packet (world switch), at
  t=5.5s a `respawn` dimension change. Reports every line sent / command
  received.
- `client_mf.js` — mineflayer bot; counts received chat + sends `/msg` every
  700ms.
- `client_nmp.js` — Raw NMP client using the **exact chat wiring from
  `startRawNmpBot()`** in `src/lib/botManager.ts`.

## Run

From the repo root (needs `npm ci` first):

```sh
node scripts/worldswitch-sim/server.js &
sleep 1
node scripts/worldswitch-sim/client_mf.js &
node scripts/worldswitch-sim/client_nmp.js
```

## Expected result (verified 2026-08-31)

```
MfBot:  chat SENT lobby=9  arena=22 | commands RECEIVED=22
NmpBot: chat SENT lobby=9  arena=22 | commands RECEIVED=22
```

Zero chat loss in either direction, straight through the switch — because in
minecraft-protocol the client is just socket → parser → event emitter. A world
switch is *another packet*: mineflayer resets its world model from the same
event stream and keeps going. There is no ECS, no tick scheduler, no locks for
a chat write to deadlock against (which is what wedges the azalea engine).

Also visible: the client re-emits `login` after the backend switch — any
per-login `setInterval` (e.g. Anti-AFK) must be cleared first or it doubles.
