// Mineflayer client — same fake server, same world switch. Shows how mineflayer
// behaves: it should just keep emitting messagestr straight through the switch.
const mineflayer = require('mineflayer')

const received = { lobby: 0, arena: 0, other: 0 }
let lastThree = []
let sent = 0

const bot = mineflayer.createBot({
  host: '127.0.0.1', port: 25577, username: 'MfBot', version: '1.20.1', auth: 'offline',
})

bot.on('messagestr', (m) => {
  const s = String(m)
  if (s.startsWith('[lobby]')) received.lobby++
  else if (s.startsWith('[arena]')) received.arena++
  else received.other++
  lastThree.push(`${new Date().toISOString().slice(14, 23)} ${s}`)
  if (lastThree.length > 3) lastThree.shift()
})

bot.on('login', () => {
  console.log('[mf] logged in to lobby')
  let n = 0
  const t = setInterval(() => { bot.chat(`/msg Blue_Umbre1 hi #${n}`); sent++; n++ }, 700)
  bot.on('end', () => clearInterval(t))
})

bot.on('respawn', () => console.log('[mf] respawn event fired (world switch handled)'))
bot.on('end', (r) => console.log(`[mf] DISCONNECTED: ${r}`))
bot.on('error', (e) => console.log(`[mf] ERROR: ${e.message}`))
bot.on('kicked', (r) => console.log(`[mf] KICKED: ${r}`))

setTimeout(() => {
  console.log('\n[mf] ==== CLIENT REPORT ====')
  console.log(`[mf] chat RECEIVED: lobby=${received.lobby} arena=${received.arena} other=${received.other}`)
  console.log(`[mf] chat SEND attempts: ${sent}`)
  console.log(`[mf] last 3 lines seen: ${JSON.stringify(lastThree)}`)
  process.exit(0)
}, 10500)
