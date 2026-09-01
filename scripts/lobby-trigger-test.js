// Lobby-beam trigger test — runs the REAL code from src/lib/botManager.ts
// (extracts extractSenderAndMessage from the source and evals it, so there is
// zero drift between this test and what ships).
//
// Run: node scripts/lobby-trigger-test.js   (from the repo root)
const fs = require('fs')
const path = require('path')

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'botManager.ts'), 'utf8')
const fnSrc = src.match(/function extractSenderAndMessage[\s\S]*?\n\}/)
if (!fnSrc) { console.error('FAIL: could not find extractSenderAndMessage in botManager.ts'); process.exit(1) }
// strip the TS signature (eval runs plain JS)
eval(fnSrc[0].replace(/^function extractSenderAndMessage\([^)]*\)[^\n]*\{/, 'function extractSenderAndMessage(raw) {'))

// Same helpers the lobby branch uses
const isValidUsername = (n) => /^[A-Za-z0-9_]{3,16}$/.test(n)
const self = 'Luci1f'
function buildTriggerRe(triggerWord) {
  return new RegExp(
    `(?:^|[^A-Za-z0-9_])${triggerWord.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`,
    'i',
  )
}

// Replica of the lobby branch's onChat decision (same rules, timestamps injected)
function makeDecider({ triggerWord = '123', replyCooldownMs = 15 * 60 * 1000, rateLimitMs = 1500 } = {}) {
  const triggerRe = buildTriggerRe(triggerWord)
  const replied = new Map()
  let lastReplyAt = -Infinity
  return (raw, now = Date.now()) => {
    if (raw.startsWith('<you')) return null
    if (!triggerRe.test(raw)) return null
    const parsed = extractSenderAndMessage(raw)
    if (!parsed) return null
    const sender = parsed.sender
    if (!isValidUsername(sender)) return null
    if (sender.toLowerCase() === self.toLowerCase()) return null
    if (now - (replied.get(sender.toLowerCase()) ?? -Infinity) < replyCooldownMs) return null
    if (now - lastReplyAt < rateLimitMs) return null
    replied.set(sender.toLowerCase(), now)
    lastReplyAt = now
    return `/msg ${sender} THE_REPLY`
  }
}

let pass = 0, fail = 0
const check = (name, got, want) => {
  const ok = want === null ? got === null : got === String(want)
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`) }
}

console.log('— detection & sender parsing —')
// fresh decider per case: these test detection only (rate limiting has its own
// section below with injected timestamps)
const decide = (raw) => makeDecider()(raw)
check('plain chat "<RandomKid> 123"', decide('<RandomKid> 123'), '/msg RandomKid THE_REPLY')
check('ranked "[MVP+] Kiddy: 123"', decide('[MVP+] Kiddy: 123'), '/msg Kiddy THE_REPLY')
check('arrow "ProGamer » 123"', decide('ProGamer » 123'), '/msg ProGamer THE_REPLY')
check('whisper "(From ShyGuy) 123"', decide('(From ShyGuy) 123'), '/msg ShyGuy THE_REPLY')
check('whisper "From ShyGuy2: 123"', decide('From ShyGuy2: 123'), '/msg ShyGuy2 THE_REPLY')
check('own lobby msg echo (self) skipped', decide(`<${self}> type 123 in chat for tier test all mode`), null)
check('own "123" (self) skipped', decide(`<${self}> 123`), null)
check('own sent-whisper echo skipped', decide('<you → RandomKid> yo'), null)
check('"1234" does NOT trigger (word boundary)', decide('<Someone1> 1234'), null)
check('"x123x" does NOT trigger', decide('<Someone2> x123x'), null)
check('embedded 123 in a sentence DOES trigger', decide('<Someone3> i have 123 diamonds'), '/msg Someone3 THE_REPLY')
check('system line with no sender skipped', decide('Match started! 123 players online'), null)
check('too-short name skipped', decide('<Ab> 123'), null)

console.log('— dedupe & rate limit —')
const d1 = makeDecider()
const t0 = 1_000_000
check('first trigger replies', d1('<SpammerA> 123', t0), '/msg SpammerA THE_REPLY')
check('same user again instantly → muted (15min dedupe)', d1('<SpammerA> 123', t0 + 100), null)
check('different user 1s later → muted (1.5s rate limit)', d1('<SpammerB> 123', t0 + 1000), null)
check('different user after rate limit → replies', d1('<SpammerB> 123', t0 + 1600), '/msg SpammerB THE_REPLY')
check('same user after 15min → replies again', d1('<SpammerA> 123', t0 + 15 * 60 * 1000 + 2000), '/msg SpammerA THE_REPLY')

console.log('— custom trigger word with punctuation —')
const d2 = makeDecider({ triggerWord: 'tier-test' })
check('custom trigger matches', d2('<Player9> tier-test'), '/msg Player9 THE_REPLY')
check('partial custom trigger does not match', d2('<Player8> tier'), null)

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
