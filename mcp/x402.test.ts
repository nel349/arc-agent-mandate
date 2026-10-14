import { test } from "node:test";
import assert from "node:assert/strict";
import { chargeOf } from "./x402.ts";

/**
 * Whether a purchase cost the agent's escrow, decided from what the seller answered.
 *
 * The receipts below are the x402 settlement header as a seller writes it, base64 JSON, including
 * the exact one the maze sends on the 503 for a step it was paid for and could not record. Reading
 * the status alone, the connector told its person nothing had been charged for that step.
 */
const receipt = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64");

const MAZE_503_RECEIPT = receipt({
  success: true, transaction: "b", network: "eip155:5042002",
  payer: "0x3333333333333333333333333333333333333333",
});

test("a seller that took the payment and then failed the request charged the escrow", () => {
  assert.deepEqual(chargeOf(false, MAZE_503_RECEIPT), {
    charged: true,
    settlement: { success: true, transaction: "b" },
  });
});

test("a seller that served charged the escrow, with or without a receipt", () => {
  assert.deepEqual(chargeOf(true, null), { charged: true });
  assert.deepEqual(chargeOf(true, receipt({ success: true, transaction: "0xbatch" })), {
    charged: true,
    settlement: { success: true, transaction: "0xbatch" },
  });
});

test("a refused payment charged nothing, and keeps the reason the seller gave", () => {
  assert.deepEqual(chargeOf(false, receipt({ success: false, errorReason: "insufficient_balance" })), {
    charged: false,
    settlement: { success: false, errorReason: "insufficient_balance" },
  });
});

test("a failure with no receipt, or one nobody can read, charged nothing", () => {
  assert.deepEqual(chargeOf(false, null), { charged: false });
  assert.deepEqual(chargeOf(false, "not base64 json"), { charged: false });
});

/**
 * An agent told an answer cost five cents paid the ten the seller asked, and learned the price from
 * the receipt. With a limit the seller's price is read first, and one above it is refused before any
 * money is moved or anything signed.
 */
test("a price above the buyer's limit is refused before anything is funded or signed; one within it goes ahead", async () => {
  const { chain } = await import("./chain.ts");
  const { fetchWithPayment } = await import("./x402.ts");
  const { privateKeyToAccount } = await import("viem/accounts");
  const agent = privateKeyToAccount(`0x${"1".repeat(64)}`);
  const offer = {
    x402Version: 2,
    accepts: [{
      scheme: "exact", network: `eip155:${chain.id}`, amount: "100000", payTo: "0x2222222222222222222222222222222222222222",
      asset: "0x3600000000000000000000000000000000000000", maxTimeoutSeconds: 60,
      extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" },
    }],
  };
  const realFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": receipt(offer) } });
  }) as typeof fetch;
  try {
    let funded = 0;
    const ensureFunds = async () => { funded += 1; return { ok: false as const, reason: "stopped here by the test" }; };

    const over = await fetchWithPayment({ url: "https://seller.test/answer", agent, ensureFunds, most: 50_000n });
    assert.equal(over.paid, false);
    assert.equal(!over.paid && over.overLimit, true);
    assert.equal(!over.paid && over.amount, 100_000n);
    assert.equal(funded, 0, "nothing was funded for a price above the limit");
    assert.equal(requests, 1, "only the price was asked; no payment was sent");

    const within = await fetchWithPayment({ url: "https://seller.test/answer", agent, ensureFunds, most: 100_000n });
    assert.equal(!within.paid && within.overLimit, undefined);
    assert.equal(funded, 1, "a price at the limit goes on to be funded");
  } finally {
    globalThis.fetch = realFetch;
  }
});
