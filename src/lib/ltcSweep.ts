import { db } from "@/db";
import { invoices } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { litecoinNetwork } from "@/lib/shop";
import { logDiscordEvent } from "@/lib/eventLog";

// Real LTC forwarding: when an invoice is paid, sweep every UTXO on the
// invoice address to the owner's address with a signed Litecoin transaction.
// Invoice addresses are P2PKH (L…) generated per purchase; the WIF private
// key is stored on the invoice row, so funds are always recoverable.

// Flat fee: base + per-input. LTC min relay is ~1 sat/vB; a P2PKH-in /
// bech32-out sweep is ~200 vB, so 1500 sats covers a few inputs with margin
// and stays negligible even on $0.10 test purchases.
const FEE_BASE_SATS = 1000;
const FEE_PER_INPUT_SATS = 500;
const DUST_LIMIT_SATS = 546;

type Utxo = { txid: string; vout: number; valueSats: number };

type SweepResult = { ok: true; txid: string } | { ok: false; reason: string };

function ltcLibs() {
  const ecc = require("tiny-secp256k1");
  const { ECPairFactory } = require("ecpair");
  const bitcoin = require("bitcoinjs-lib");
  return { ecc, ECPair: ECPairFactory(ecc), bitcoin };
}

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 10_000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, ok: res.ok, data };
  } finally {
    clearTimeout(timer);
  }
}

/** Unspent outputs for an address: BlockCypher first, litecoinspace fallback. */
async function fetchUtxos(address: string): Promise<Utxo[]> {
  // BlockCypher
  try {
    const r = await fetchJson(
      `https://api.blockcypher.com/v1/ltc/main/addrs/${address}?unspentOnly=true&limit=50`,
    );
    if (r.ok) {
      const refs = [...(r.data?.txrefs || []), ...(r.data?.unconfirmed_txrefs || [])]
        .filter((t: any) => typeof t.tx_hash === "string" && typeof t.tx_output_n === "number")
        .filter((t: any) => (t.confirmations ?? 0) > 0 || r.data?.txrefs?.length === 0);
      const seen = new Set<string>();
      const utxos: Utxo[] = [];
      for (const t of refs) {
        const key = `${t.tx_hash}:${t.tx_output_n}`;
        if (seen.has(key)) continue;
        seen.add(key);
        utxos.push({ txid: t.tx_hash, vout: t.tx_output_n, valueSats: t.value || 0 });
      }
      if (utxos.length > 0) return utxos;
    }
  } catch (err) {
    console.warn(`[sweep] blockcypher utxo fetch failed: ${err instanceof Error ? err.message : err}`);
  }
  // litecoinspace (mempool-style API)
  try {
    const r = await fetchJson(`https://litecoinspace.org/api/address/${address}/utxo`);
    if (r.ok && Array.isArray(r.data)) {
      return r.data
        .filter((u: any) => u.status?.confirmed !== false)
        .map((u: any) => ({ txid: u.txid, vout: u.vout, valueSats: u.value }));
    }
  } catch (err) {
    console.warn(`[sweep] litecoinspace utxo fetch failed: ${err instanceof Error ? err.message : err}`);
  }
  return [];
}

/** Raw transaction hex for a UTXO's parent tx (needed to sign P2PKH inputs). */
async function fetchRawTx(txid: string): Promise<Buffer | null> {
  try {
    const r = await fetchJson(
      `https://api.blockcypher.com/v1/ltc/main/txs/${txid}?includeHex=true`,
    );
    if (r.ok && typeof r.data?.hex === "string") return Buffer.from(r.data.hex, "hex");
  } catch {}
  try {
    const r = await fetchJson(`https://litecoinspace.org/api/tx/${txid}/hex`);
    if (r.ok && typeof r.data === "string" && r.data.length > 0) {
      return Buffer.from(r.data.trim(), "hex");
    }
  } catch {}
  return null;
}

/** Broadcast a signed raw tx: BlockCypher first, litecoinspace fallback. */
async function broadcastTx(hex: string): Promise<{ txid?: string; broadcasted: boolean; error?: string }> {
  try {
    const r = await fetchJson(`https://api.blockcypher.com/v1/ltc/main/txs/push`, {
      method: "POST",
      body: JSON.stringify({ tx: hex }),
    });
    if (r.ok && r.data?.tx?.hash) return { txid: r.data.tx.hash, broadcasted: true };
    const errText = typeof r.data === "object" ? JSON.stringify(r.data) : String(r.data);
    if (/already|mempool|conflict/i.test(errText)) return { broadcasted: true, error: errText };
  } catch (err) {
    console.warn(`[sweep] blockcypher broadcast failed: ${err instanceof Error ? err.message : err}`);
  }
  try {
    const r = await fetchJson(`https://litecoinspace.org/api/tx`, {
      method: "POST",
      body: hex,
    });
    if (r.ok && typeof r.data === "string") return { txid: r.data, broadcasted: true };
    const errText = typeof r.data === "object" ? JSON.stringify(r.data) : String(r.data);
    if (/already|mempool|conflict|sendrawtransaction/i.test(errText)) return { broadcasted: true, error: errText };
    return { broadcasted: false, error: errText };
  } catch (err) {
    return { broadcasted: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Build + sign + broadcast a sweep of every UTXO on `address` to `owner`. */
export async function sweepAddressToOwner(params: {
  address: string;
  privateKeyWif: string;
  ownerAddress: string;
}): Promise<SweepResult> {
  const { address, privateKeyWif, ownerAddress } = params;
  if (!address || !privateKeyWif || !ownerAddress) {
    return { ok: false, reason: "missing address, key or owner address" };
  }

  const utxos = await fetchUtxos(address);
  if (utxos.length === 0) return { ok: false, reason: "no confirmed UTXOs" };

  const totalSats = utxos.reduce((sum, u) => sum + u.valueSats, 0);
  const feeSats = FEE_BASE_SATS + FEE_PER_INPUT_SATS * utxos.length;
  const sendSats = totalSats - feeSats;
  if (sendSats < DUST_LIMIT_SATS) {
    return { ok: false, reason: `amount after fee (${sendSats} sats) is below dust` };
  }

  const { bitcoin, ECPair } = ltcLibs();
  let keyPair;
  try {
    keyPair = ECPair.fromWIF(privateKeyWif, litecoinNetwork);
  } catch {
    return { ok: false, reason: "invalid stored private key" };
  }

  const psbt = new bitcoin.Psbt({ network: litecoinNetwork });
  for (const utxo of utxos) {
    const prevTx = await fetchRawTx(utxo.txid);
    if (!prevTx) return { ok: false, reason: `could not fetch raw tx ${utxo.txid}` };
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      nonWitnessUtxo: prevTx,
    });
  }
  psbt.addOutput({ address: ownerAddress, value: sendSats });

  for (let i = 0; i < utxos.length; i++) {
    psbt.signInput(i, keyPair);
  }
  psbt.finalizeAllInputs();
  const tx = psbt.extractTransaction();
  const hex = tx.toHex();
  const txid = tx.getId();

  const result = await broadcastTx(hex);
  if (!result.broadcasted) {
    return { ok: false, reason: result.error || "broadcast rejected" };
  }
  console.log(`[sweep] ${address} -> ${ownerAddress}: ${(sendSats / 1e8).toFixed(8)} LTC (tx ${result.txid || txid})`);
  return { ok: true, txid: result.txid || txid };
}

/** Sweep one paid invoice; flips status paid/forwarding -> forwarded. */
export async function forwardInvoice(invoiceId: string): Promise<SweepResult> {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!invoice) return { ok: false, reason: "invoice not found" };
  if (invoice.status === "forwarded") return { ok: true, txid: "" };

  // Claim the invoice so concurrent attempts don't double-broadcast.
  await db.update(invoices).set({ status: "forwarding" }).where(eq(invoices.id, invoiceId));

  const result = await sweepAddressToOwner({
    address: invoice.ltcAddress,
    privateKeyWif: invoice.ltcPrivateKey,
    ownerAddress: invoice.ownerLtcAddress,
  });

  if (result.ok) {
    await db.update(invoices).set({ status: "forwarded" }).where(eq(invoices.id, invoiceId));
    logDiscordEvent("purchase", {
      title: "Payment forwarded",
      description: "Invoice paid and swept to the owner wallet.",
      color: 0x10b981,
      fields: [
        { name: "Amount", value: `${invoice.amountLTC} LTC`, inline: true },
        { name: "Tx", value: result.txid ? `\`${result.txid.slice(0, 32)}…\`` : "broadcast", inline: true },
      ],
    });
    return result;
  }

  // Not forwarded (yet) — back to paid so the sweeper retries.
  await db.update(invoices).set({ status: "paid" }).where(eq(invoices.id, invoiceId));
  console.warn(`[sweep] invoice ${invoiceId} forward failed: ${result.reason}`);
  return result;
}

// ---------------------------------------------------------------------------
// Background sweeper — retries paid invoices whose sweep failed or crashed.
// ---------------------------------------------------------------------------

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const globalForSweeper = globalThis as typeof globalThis & {
  __mcbmSweepTimer?: ReturnType<typeof setInterval>;
};

export function startInvoiceSweeper(): void {
  if (globalForSweeper.__mcbmSweepTimer) return;
  globalForSweeper.__mcbmSweepTimer = setInterval(() => {
    void sweepPendingInvoices();
  }, SWEEP_INTERVAL_MS);
  // Also run once shortly after boot.
  setTimeout(() => void sweepPendingInvoices(), 90_000);
}

async function sweepPendingInvoices(): Promise<void> {
  try {
    const stuck = await db
      .select()
      .from(invoices)
      .where(inArray(invoices.status, ["paid", "forwarding"]));
    for (const invoice of stuck) {
      // Skip in-flight attempts younger than 10 minutes (avoid racing the
      // immediate forward that runs right after payment detection).
      const paidAtMs = invoice.paidAt ? invoice.paidAt.getTime() : 0;
      if (invoice.status === "forwarding" && Date.now() - paidAtMs < 10 * 60 * 1000) {
        continue;
      }
      await forwardInvoice(invoice.id);
    }
  } catch (err) {
    console.warn(`[sweep] sweeper failed: ${err instanceof Error ? err.message : err}`);
  }
}
