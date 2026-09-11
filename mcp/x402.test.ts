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
