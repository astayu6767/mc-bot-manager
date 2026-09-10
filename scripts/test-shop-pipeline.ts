// Offline tests for the LTC sweep transaction path and the purchase panel
// payload builder. No network calls, no DB. Run with:
//   npx tsx scripts/test-shop-pipeline.ts
import { litecoinNetwork } from "../src/lib/shop";
import { buildPlanDetailPayload, buildPurchasePanelPayload } from "../src/server/discord/purchasePanel";

/* eslint-disable @typescript-eslint/no-require-imports */
const ecc = require("tiny-secp256k1");
const { ECPairFactory } = require("ecpair");
const bitcoin = require("bitcoinjs-lib");
/* eslint-enable @typescript-eslint/no-require-imports */

const OWNER_ADDR = "ltc1qcyz0yaw2h0cgcr9nqhqty0kc0c8gw3ykfqeasy";

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

const ECPair = ECPairFactory(ecc);

// --- LTC address generation matches the invoice flow (P2PKH, L prefix) ---
const invoiceKey = ECPair.makeRandom({ network: litecoinNetwork });
const invoiceAddr = bitcoin.payments.p2pkh({
  pubkey: invoiceKey.publicKey,
  network: litecoinNetwork,
}).address as string;
check("invoice address is P2PKH L…", invoiceAddr.startsWith("L"), true);

// WIF roundtrip — this is exactly what the sweep does with the stored key
const wif = invoiceKey.toWIF();
const restored = ECPair.fromWIF(wif, litecoinNetwork);
check(
  "WIF restores the same pubkey",
  Buffer.compare(Buffer.from(restored.publicKey), Buffer.from(invoiceKey.publicKey)),
  0,
);

// --- Build a fake funding tx paying the invoice address ---
const fundTx = new bitcoin.Transaction();
fundTx.version = 2;
fundTx.addInput(Buffer.alloc(32), 0);
fundTx.addOutput(bitcoin.address.toOutputScript(invoiceAddr, litecoinNetwork), 100_000);
const fundTxHex = fundTx.toHex();

// --- Sweep it to the owner's bech32 address (same code path as ltcSweep) ---
const FEE = 1000 + 500 * 1; // FEE_BASE + per-input, mirrors ltcSweep.ts
const psbt = new bitcoin.Psbt({ network: litecoinNetwork });
psbt.addInput({ hash: fundTx.getId(), index: 0, nonWitnessUtxo: Buffer.from(fundTxHex, "hex") });
psbt.addOutput({ address: OWNER_ADDR, value: 100_000 - FEE });
psbt.signInput(0, restored);
const validator = (pubkey: Buffer, msghash: Buffer, signature: Buffer) =>
  ecc.verify(msghash, pubkey, signature) as boolean;
check("input signature valid", psbt.validateSignaturesOfInput(0, validator), true);
psbt.finalizeAllInputs();
const sweepTx = psbt.extractTransaction();
check("sweep has 1 output", sweepTx.outs.length, 1);
check("sweep pays the dust-safe amount", sweepTx.outs[0].value, 100_000 - FEE);
check(
  "sweep pays the owner's bech32 address",
  Buffer.compare(
    sweepTx.outs[0].script,
    bitcoin.address.toOutputScript(OWNER_ADDR, litecoinNetwork),
  ),
  0,
);
check("sweep txid is hex", /^[0-9a-f]{64}$/.test(sweepTx.getId()), true);
check("sweep hex is serializable", typeof sweepTx.toHex() === "string" && sweepTx.toHex().length > 100, true);

// --- Purchase panel payload ---
const plans = [
  {
    id: "p1",
    tier: "STARTER",
    price: 5,
    bots: 2,
    hours: 6,
    features: JSON.stringify(["2 bots"]),
    popular: "false",
    discount: 0,
  },
  {
    id: "p2",
    tier: "TEST",
    price: 0.1,
    bots: 1,
    hours: 1,
    features: JSON.stringify(["1 bot slot"]),
    popular: "false",
    discount: 0,
  },
  {
    id: "p3",
    tier: "PRO",
    price: 8,
    bots: 5,
    hours: 12,
    features: JSON.stringify(["5 bots"]),
    popular: "true",
    discount: 50,
  },
];

const payload = buildPurchasePanelPayload(plans, "https://panel.badlion-pvp.xyz");
check("panel has 1 embed", payload.embeds.length, 1);
const embedJson = JSON.parse(JSON.stringify(payload.embeds[0].toJSON()));
check("panel embed lists all tiers", embedJson.fields.filter((f: any) => f.name.includes("/mo")).length, 3);
const testField = embedJson.fields.find((f: any) => f.name.includes("TEST"));
check("test plan shows $0.10/mo", testField.name.includes("$0.1/mo"), true);
const proField = embedJson.fields.find((f: any) => f.name.includes("PRO"));
check("discounted PRO shows $4/mo", proField.name.includes("$4/mo"), true);
check("panel has select + buttons rows", payload.components.length, 2);
const selectJson = JSON.parse(JSON.stringify(payload.components[0].toJSON()));
check("select has 3 options", selectJson.components[0].options.length, 3);
check("select custom id is plan:buy", selectJson.components[0].custom_id, "plan:buy");
const buttonsJson = JSON.parse(JSON.stringify(payload.components[1].toJSON()));
check("button row has Buy License + Dashboard", buttonsJson.components.length, 2);

const noUrl = buildPurchasePanelPayload(plans, "");
check("no site url -> select only", noUrl.components.length, 1);

const detail = buildPlanDetailPayload(plans[2], "https://panel.badlion-pvp.xyz");
const detailJson = JSON.parse(JSON.stringify(detail.embeds[0].toJSON()));
check("detail shows discounted price", detailJson.fields[0].value, "$4 / month");
check("detail popular tag in title", detailJson.title.includes("most popular"), true);
check("detail has Buy License button", detail.components.length, 1);

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
