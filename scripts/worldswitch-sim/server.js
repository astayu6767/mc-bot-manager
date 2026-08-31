// Fake "Minemen-like" server: accepts a bot in a "lobby", streams chat, then at
// t=3s performs a BungeeCord-style backend switch (a SECOND login packet on the
// SAME socket — exactly what eu.minemen.club does for arena transfers), keeps
// streaming chat, then at t=5.5s also sends a respawn/dimension change.
// At the end it reports everything it sent/received so we can verify continuity.
const mc = require('minecraft-protocol')
const mcData = require('minecraft-data')('1.20.1')

const SENT = {} // per username: { lobby: n, arena: n }
const CMDS = {} // per username: count of chat commands received

const server = mc.createServer({
  'online-mode': false,
  version: '1.20.1',
  port: 25577,
})

server.on('login', (client) => {
  const name = client.username
  SENT[name] = { lobby: 0, arena: 0 }
  CMDS[name] = 0
  console.log(`[server] ${name} joined the lobby`)

  client.write('login', mcData.loginPacket)
  client.write('position', { x: 0, y: 64, z: 0, yaw: 0, pitch: 0, flags: 0, teleportId: 1 })

  let phase = 'lobby'
  let i = 0
  const chatTimer = setInterval(() => {
    const text = `[${phase}] player${i % 5}: msg#${i}`
    SENT[name][phase]++
    try {
      client.write('system_chat', { content: JSON.stringify({ text }), isGui: false })
    } catch (e) {
      console.log(`[server] write failed to ${name}: ${e.message}`)
    }
    i++
  }, 300)

  const countCmd = (pkt) => {
    const m = pkt.command || pkt.message || ''
    if (m.startsWith('msg') || m.startsWith('/msg')) {
      CMDS[name]++
      console.log(`[server] ${phase} ← ${name}: /${m.slice(0, 40)}`)
    }
  }
  client.on('chat_command', countCmd)
  client.on('chat', countCmd)

  // t=3s: BungeeCord-style switch to the duel backend (2nd login packet, same socket)
  setTimeout(() => {
    phase = 'arena'
    client.write('login', { ...mcData.loginPacket, entityId: 100, worldName: 'minecraft:duel_arena_1' })
    client.write('position', { x: 100, y: 64, z: 100, yaw: 0, pitch: 0, flags: 0, teleportId: 2 })
    console.log(`[server] >>> ${name}: SWITCHED to duel_arena_1 (2nd login packet, same socket)`)
  }, 3000)

  // t=5.5s: respawn dimension change (some networks do this instead)
  setTimeout(() => {
    try {
      client.write('respawn', {
        dimension: mcData.loginPacket.worldType,
        worldName: 'minecraft:duel_arena_2',
        hashedSeed: 0n,
        gamemode: 0,
        previousGamemode: 0,
        isDebug: false,
        isFlat: false,
        copyMetadata: true,
      })
      console.log(`[server] >>> ${name}: respawn packet (dimension change)`)
    } catch (e) {
      console.log(`[server] respawn write failed: ${e.message}`)
    }
  }, 5500)

  client.on('end', () => clearInterval(chatTimer))
  client.on('error', (e) => { console.log(`[server] ${name} ERROR: ${e.message}`); clearInterval(chatTimer) })
})

server.on('error', (e) => console.log('[server] ERROR', e.message))
server.on('listening', () => console.log('[server] fake minemen listening on :25577'))

setTimeout(() => {
  console.log('\n[server] ==== FINAL REPORT ====')
  for (const [name, s] of Object.entries(SENT)) {
    console.log(`[server] ${name}: chat SENT lobby=${s.lobby} arena=${s.arena} | commands RECEIVED=${CMDS[name]}`)
  }
  process.exit(0)
}, 11000)
