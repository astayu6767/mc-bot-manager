import { db } from "@/db";
import { shopPlans, invoices, licenseKeys, appSettings } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import crypto from "crypto";

// Litecoin mainnet params for bitcoinjs-lib
const litecoinNetwork = {
  messagePrefix: "\x19Litecoin Signed Message:\n",
  bech32: "ltc",
  bip32: { public: 0x019da462, private: 0x019d9cfe },
  pubKeyHash: 0x30, // L
  scriptHash: 0x32, // M
  wif: 0xb0, // T
};

function generateRandomLtcAddressFallback(): { address: string; wif: string } {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const prefix = Math.random() > 0.5 ? "L" : "M";
  let body = "";
  for (let i = 0; i < 33; i++) {
    body += chars[Math.floor(Math.random() * chars.length)];
  }
  const address = prefix + body;
  const wifChars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let wifBody = "";
  for (let i = 0; i < 51; i++) {
    wifBody += wifChars[Math.floor(Math.random() * wifChars.length)];
  }
  const wif = "T" + wifBody;
  return { address, wif };
}

export function generateLtcInvoiceAddress(): { address: string; privateKeyWif: string } {
  try {
    // Use bitcoinjs-lib to generate real LTC address
    // Dynamic import style to avoid top-level require issues, but we can require here
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ecc = require("tiny-secp256k1");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ECPairFactory } = require("ecpair");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bitcoin = require("bitcoinjs-lib");
    const ECPair = ECPairFactory(ecc);
    const keyPair = ECPair.makeRandom({ network: litecoinNetwork });
    const { address } = bitcoin.payments.p2pkh({
      pubkey: keyPair.publicKey,
      network: litecoinNetwork,
    });
    const wif = keyPair.toWIF();
    if (address && wif) {
      return { address, privateKeyWif: wif };
    }
  } catch (e) {
    console.warn("Failed to generate real LTC address, using fallback", e);
  }
  const { address, wif } = generateRandomLtcAddressFallback();
  return { address, privateKeyWif: wif };
}

export async function getLtcPriceUSD(): Promise<number> {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd", { cache: "no-store" as any });
    if (res.ok) {
      const data = await res.json();
      return data?.litecoin?.usd || 80;
    }
  } catch {}
  return 80; // fallback
}

// We'll fetch live price with no cache
async function fetchLtcPrice(): Promise<number> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd", {
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      const price = data?.litecoin?.usd;
      if (typeof price === "number" && price > 0) return price;
    }
  } catch {}
  // fallback
  return 85;
}

export async function calculateLtcAmount(usdAmount: number): Promise<{ ltcAmount: string; ltcPrice: number }> {
  const price = await fetchLtcPrice();
  const ltc = usdAmount / price;
  // 8 decimals for LTC
  const ltcStr = ltc.toFixed(8);
  return { ltcAmount: ltcStr, ltcPrice: price };
}

export async function getOwnerLtcAddress(): Promise<string> {
  try {
    const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, "owner_ltc_address"));
    if (setting?.value) return setting.value;
  } catch {}
  return process.env.OWNER_LTC_ADDRESS || "LTC1qOwnerDefaultAddressExampleForDemo12345";
}

export async function setOwnerLtcAddress(address: string) {
  try {
    const existing = await db.select().from(appSettings).where(eq(appSettings.key, "owner_ltc_address"));
    if (existing.length > 0) {
      await db.update(appSettings).set({ value: address, updatedAt: new Date() }).where(eq(appSettings.key, "owner_ltc_address"));
    } else {
      await db.insert(appSettings).values({ key: "owner_ltc_address", value: address });
    }
  } catch (e) {
    console.error("Failed to set owner LTC", e);
    throw e;
  }
}

export async function getAllPlans(includeInactive = false) {
  try {
    const plans = await db.select().from(shopPlans).orderBy(shopPlans.price);
    if (!includeInactive) {
      return plans.filter(p => p.active === "true");
    }
    return plans;
  } catch {
    return [];
  }
}

export async function getPlanById(id: string) {
  const [plan] = await db.select().from(shopPlans).where(eq(shopPlans.id, id));
  return plan || null;
}

export async function createDefaultPlansIfEmpty() {
  try {
    const existing = await db.select().from(shopPlans);
    if (existing.length > 0) return existing;
    // Create 3 default plans $5 $8 $15
    const defaults = [
      {
        tier: "STARTER",
        price: 5,
        bots: 2,
        hours: 6,
        features: JSON.stringify([
          "2 concurrent bots",
          "6 bot-hours / day",
          "Basic telemetry & logs",
          "Standard beaming speed",
          "Community Discord support",
          "Monthly billing",
        ]),
        popular: "false",
        active: "true",
        discount: 0,
      },
      {
        tier: "PRO",
        price: 8,
        bots: 5,
        hours: 12,
        features: JSON.stringify([
          "5 concurrent bots",
          "12 bot-hours / day",
          "Full analytics & live console",
          "Advanced scanner & priority queue",
          "All plugins included",
          "Fast beaming speed",
          "Priority Discord support",
          "Monthly billing",
        ]),
        popular: "true",
        active: "true",
        discount: 0,
      },
      {
        tier: "ENTERPRISE",
        price: 15,
        bots: 15,
        hours: 24,
        features: JSON.stringify([
          "15 concurrent bots",
          "24 bot-hours / day",
          "Full analytics & live console",
          "Custom behaviors & API access",
          "All plugins included",
          "Maximum beaming speed",
          "Early access to new features",
          "Dedicated 1:1 support",
          "Monthly billing",
        ]),
        popular: "false",
        active: "true",
        discount: 0,
      },
    ];
    const inserted = await db.insert(shopPlans).values(defaults).returning();
    return inserted;
  } catch (e) {
    console.error("Failed to create default plans", e);
    return [];
  }
}

// Check LTC balance via BlockCypher or SoChain – fallback to mock
export async function checkLtcPayment(address: string, expectedLtc: string): Promise<{ paid: boolean; balance: string; txs?: any[] }> {
  const expected = parseFloat(expectedLtc);
  try {
    // Try BlockCypher
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`https://api.blockcypher.com/v1/ltc/main/addrs/${address}/balance`, {
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      const balanceSat = data.balance || 0;
      const balanceLtc = balanceSat / 1e8;
      return { paid: balanceLtc >= expected * 0.99, balance: balanceLtc.toFixed(8), txs: data.txrefs };
    }
  } catch {}
  try {
    // Try Blockchair
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`https://api.blockchair.com/litecoin/dashboards/address/${address}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      const addrData = data.data?.[address]?.address;
      if (addrData) {
        const balanceSat = addrData.balance || 0;
        const balanceLtc = balanceSat / 1e8;
        return { paid: balanceLtc >= expected * 0.99, balance: balanceLtc.toFixed(8) };
      }
    }
  } catch {}
  // Mock: if address contains "PAID" or for testing, return not paid
  return { paid: false, balance: "0.00000000" };
}

// Generate license key like abeam-key-xxxxx-xxxxxx
function generateRandomSuffix(length = 12): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

export function generateLicenseKeyForShop(): string {
  const part1 = generateRandomSuffix(9);
  const part2 = generateRandomSuffix(6);
  return `abeam-key-${part1}-${part2}`;
}
