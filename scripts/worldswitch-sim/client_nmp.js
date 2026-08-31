// Raw NMP style client — replicates the EXACT chat wiring from
// startRawNmpBot() in src/lib/botManager.ts (systemChat/playerChat handlers +
// the same chat() write pattern). Proves the NMP engine keeps receiving and
// sending chat through a mid-stream world switch.
const mc = require('minecraft-protocol')

function extractText(c) {
  if (typeof c === 'string') { try { c = JSON.parse(c) } catch { return c } }
  if (!c || typeof c !== 'object') return String(c ?? '')
  if (typeof c.text === 'string' && c.text) return c.text
  if (Array.isArray(c.extra)) return c.extra.map(extractText).join('')
  return ''
}

const received = { lobby: 0, arena: 0, other: 0 }
let lastThree = []
const sentCmds = { ok: 0 }

const client = mc.createClient({
  host: '127.0.0.1', port: 25577, username: 'NmpBot', version: '1.20.1', auth: 'offline',
})

client.on('systemChat', (d) => {
  let text = ''
  try { text = extractText(JSON.parse(d.formattedMessage || d.content)) } catch { text = d.formattedMessage || d.content || '' }
  if (!text) return
  if (text.startsWith('[lobby]')) received.lobby++
  else if (text.startsWith('[arena]')) received.arena++
  else received.other++
  lastThree.push(`${new Date().toISOString().slice(14, 23)} ${text}`)
  if (lastThree.length > 3) lastThree.shift()
})

client.on('playerChat', (d) => {
  const content = d.plainMessage || d.unsignedChat || ''
  if (!content) return
  if (content.startsWith('[lobby]')) received.lobby++
  else if (content.startsWith('[arena]')) received.arena++
  else received.other++
})

// Same client.chat pattern as startRawNmpBot
client.chat = (message) => {
  const isCmd = message.startsWith('/')
  try {
    client.write('chat', { message })
  } catch {
    try {
      if (isCmd) client.write('chat_command', { command: message.slice(1), timestamp: BigInt(Date.now()), salt: BigInt(0), argumentSignatures: [], signedPreview: false, messageCount: 0, acknowledged: Buffer.alloc(3), previousMessages: [] })
      else client.write('chat_message', { message, timestamp: BigInt(Date.now()), salt: BigInt(0), signature: Buffer.alloc(0), signedPreview: false, messageCount: 0, acknowledged: Buffer.alloc(3), previousMessages: [] })
    } catch {}
  }
}

client.on('login', () => {
  console.log('[nmp] logged in to lobby')
  let n = 0
  const t = setInterval(() => {
    client.chat(`/msg Blue_Umbre1 hey #${n}`)
    sentCmds.ok++
    n++
  }, 700)
  client.on('end', () => clearInterval(t))
})

client.on('end', (r) => console.log(`[nmp] DISCONNECTED: ${r}`))
client.on('error', (e) => console.log(`[nmp] ERROR: ${e.message}`))

setTimeout(() => {
  console.log('\n[nmp] ==== CLIENT REPORT ====')
  console.log(`[nmp] chat RECEIVED: lobby=${received.lobby} arena=${received.arena} other=${received.other}`)
  console.log(`[nmp] chat SEND attempts: ${sentCmds.ok}`)
  console.log(`[nmp] last 3 lines seen: ${JSON.stringify(lastThree)}`)
  process.exit(0)
}, 10500)
