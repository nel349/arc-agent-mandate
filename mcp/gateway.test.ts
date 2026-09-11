import { test } from "node:test";
import assert from "node:assert/strict";
import { escrowLedger, topUpCalls } from "./gateway.ts";

/**
 * The first tests the connector has ever had. `npm test` globbed `src/**` only, so every module
 * under `mcp/` — the half that actually spends money — was unreachable by the unit suite.
 */

// ---- what the chain says, versus what Circle will accept ---------------------

/**
 * The bug these exist for, measured rather than imagined: a $0.002 purchase refused while the
 * chain reported $0.008 of escrow. Payments accepted into a batch are committed for about a
 * quarter of an hour before the balance moves, so trusting the chain means declining to top up
 * and then being refused anyway.
 */
const USD = (n: number): bigint => BigInt(Math.round(n * 1_000_000));

test("with nothing claimed, spendable is exactly what the chain says", () => {
  const ledger = escrowLedger();
  assert.equal(ledger.spendable(USD(0.04)), USD(0.04));
});

test("a claimed payment stops counting, before the chain has noticed it", () => {
  const ledger = escrowLedger();
  ledger.spendable(USD(0.04));
  ledger.claimed(USD(0.01));
  // The chain has not moved — that is the whole problem — and the estimate has.
  assert.equal(ledger.spendable(USD(0.04)), USD(0.03));
});

test("claims accumulate, so a run of small payments is not counted once", () => {
  const ledger = escrowLedger();
  ledger.spendable(USD(0.04));
  for (let i = 0; i < 16; i++) ledger.claimed(USD(0.001));
  assert.equal(ledger.spendable(USD(0.04)), USD(0.024));
});

test("when the batch lands, the claim stops being outstanding rather than counting twice", () => {
  const ledger = escrowLedger();
  ledger.spendable(USD(0.04));
  ledger.claimed(USD(0.01));
  assert.equal(ledger.spendable(USD(0.04)), USD(0.03), "still pending");

  // The batch settles: the chain drops by what settled.
  assert.equal(ledger.spendable(USD(0.03)), USD(0.03), "settled, and not subtracted a second time");
});

test("a partial settlement leaves the rest outstanding", () => {
  const ledger = escrowLedger();
  ledger.spendable(USD(0.10));
  ledger.claimed(USD(0.02));
  ledger.claimed(USD(0.02));
  // Only the first has landed.
  assert.equal(ledger.spendable(USD(0.08)), USD(0.06), "one settled, one still in flight");
});

test("a top-up raises what is spendable without clearing what is owed", () => {
  const ledger = escrowLedger();
  ledger.spendable(USD(0.01));
  ledger.claimed(USD(0.008));
  assert.equal(ledger.spendable(USD(0.01)), USD(0.002));

  // Deposit $0.10. The chain rises; the pending claim is still pending.
  assert.equal(ledger.spendable(USD(0.11)), USD(0.102));
});

test("it never reports more than nothing, however the numbers arrive", () => {
  const ledger = escrowLedger();
  ledger.spendable(USD(0.01));
  ledger.claimed(USD(1));
  assert.equal(ledger.spendable(USD(0.01)), 0n, "an over-claim is empty, not negative");

  // And a chain figure that drops further than anything outstanding does not go negative either.
  assert.equal(ledger.spendable(0n), 0n);
});

// ---- surviving a restart ------------------------------------------------------

/**
 * An MCP client restarts the connector whenever it reconnects. With the tally in memory only, a
 * restart inside the quarter hour a batch takes forgot what was still settling, the escrow looked
 * fuller than it was, and the next payment was refused.
 */
test("a ledger started from what was remembered carries on where it stopped", () => {
  const ledger = escrowLedger({ outstanding: USD(0.01), lastSeen: USD(0.04) });
  assert.equal(ledger.spendable(USD(0.04)), USD(0.03), "the payment still settling was forgotten");
  // And the batch landing is noticed across the restart, not subtracted twice.
  assert.equal(ledger.spendable(USD(0.03)), USD(0.03));
});

test("every change to the tally is handed over to be remembered, and nothing else is", () => {
  const kept: unknown[] = [];
  const ledger = escrowLedger(undefined, (tally) => kept.push(tally));

  ledger.spendable(USD(0.04));
  ledger.claimed(USD(0.01));
  ledger.spendable(USD(0.04)); // nothing moved, so nothing to remember
  ledger.spendable(USD(0.03)); // the batch landed

  assert.deepEqual(kept, [
    { outstanding: 0n, lastSeen: USD(0.04) },
    { outstanding: USD(0.01), lastSeen: USD(0.04) },
    { outstanding: 0n, lastSeen: USD(0.03) },
  ]);
});

// ---- the calls a top-up sends ------------------------------------------------

test("a top-up is still an approval and a deposit, in that order", () => {
  const agent = "0x1111111111111111111111111111111111111111" as const;
  const calls = topUpCalls(agent, USD(0.5));
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.value, 0n, "the ERC-20 rail carries no native value");
});
