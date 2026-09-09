// Unit tests for the pure Discord-bot helpers. Run with:
//   npx tsx scripts/test-discord-utils.ts
import { bullets, parseDuration, smoothChannelName } from "../src/server/discord/utils";

let failures = 0;
let passes = 0;

function check(name: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) {
    passes++;
  } else {
    failures++;
    console.error(`FAIL  ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
  }
}

// --- smoothChannelName ---
check("smooth: general", smoothChannelName("general"), "💬-general");
check("smooth: keeps emoji prefix word", smoothChannelName("💬-General Chat"), "💬-general-chat");
check("smooth: ticket", smoothChannelName("TICKET-0001"), "🎧-ticket-0001");
check("smooth: rules", smoothChannelName("RULES"), "📜-rules");
check("smooth: ltc payments", smoothChannelName("LTC-PAYMENTS"), "🛒-ltc-payments");
check("smooth: logs-bots matches log rule first", smoothChannelName("logs-bots"), "📋-logs-bots");
check("smooth: memes", smoothChannelName("memes"), "😈-memes");
check("smooth: staff room", smoothChannelName("staff-room"), "🛡️-staff-room");
check("smooth: announcements", smoothChannelName("announcements"), "📢-announcements");
check("smooth: voice channel", smoothChannelName("🔊-VOICE-CHANNEL"), "🔊-voice-channel");
check("smooth: welcome", smoothChannelName("welcome"), "👋-welcome");
check("smooth: licenses", smoothChannelName("licenses"), "🔑-licenses");
check("smooth: bug reports", smoothChannelName("bug-reports"), "🐞-bug-reports");
check("smooth: fallback for unknown", smoothChannelName("zzz-unknown-thing"), "✨-zzz-unknown-thing");
check("smooth: empty becomes channel", smoothChannelName(""), "✨-channel");
check("smooth: symbols only", smoothChannelName("!!!"), "✨-channel");
check("smooth: double dashes collapse", smoothChannelName("a--b   c"), "✨-a-b-c");
check("smooth: already smooth stays equal", smoothChannelName("💬-general"), "💬-general");

// --- parseDuration ---
check("duration: 30d", parseDuration("30d"), { days: 30, hours: 0 });
check("duration: 12h", parseDuration("12h"), { days: 0, hours: 12 });
check("duration: 7d12h", parseDuration("7d12h"), { days: 7, hours: 12 });
check("duration: 7D12H case-insensitive", parseDuration("7D12H"), { days: 7, hours: 12 });
check("duration: bare number = days", parseDuration("5"), { days: 5, hours: 0 });
check("duration: spaces", parseDuration(" 3d 4h "), { days: 3, hours: 4 });
check("duration: zero rejected", parseDuration("0"), null);
check("duration: garbage rejected", parseDuration("abc"), null);
check("duration: minutes not supported", parseDuration("1h30m"), null);
check("duration: empty rejected", parseDuration(""), null);

// --- bullets ---
check("bullets: comma list", bullets("a, b,c"), "- a\n- b\n- c");
check("bullets: newlines", bullets("x\n\ny"), "- x\n- y");
check("bullets: mixed separators", bullets("a\nb, c"), "- a\n- b\n- c");
check("bullets: empty", bullets(""), "");
check("bullets: whitespace only", bullets(" , , "), "");

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
