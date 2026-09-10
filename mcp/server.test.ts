import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A structural test, for a bug that unit tests could not have caught.
 *
 * `escrowLedger` was correct and thoroughly tested. The defect was that two of the three places
 * asking "how much is in escrow" never went through it: `check_allowance` reported the chain's raw
 * figure and told the user $0.063 was spendable when $0.039 was, and `top_up` sized its deposit
 * against the same raw figure, asking for whatever had not settled a second time — money that
 * escrow only releases as a payment or a delayed withdrawal.
 *
 * No test of the ledger can find that, because the ledger was never wrong. What was wrong was a
 * call site not using it, so what is worth asserting is that exactly one call site exists. The
 * maze does the same thing to keep its router and its published endpoint list in step.
 */

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "server.ts"), "utf8");

/** Ignore the import statement, which names the symbol without calling it. */
const callSites = (haystack: string, fn: string): number =>
  (haystack.match(new RegExp(`\\b${fn}\\(`, "g")) ?? []).length;

test("the chain's escrow figure is read in exactly one place", () => {
  assert.equal(
    callSites(source, "readEscrow"),
    1,
    "A second reader of the raw balance has appeared. Every caller must go through " +
      "spendableEscrow(), or reporting and funding will disagree by whatever has not settled.",
  );
});

test("that one place subtracts what has been claimed and not yet settled", () => {
  const body = source.slice(source.indexOf("async function spendableEscrow("));
  const end = body.indexOf("\n}");
  assert.ok(end > 0, "spendableEscrow() is gone; the single reader it enforces went with it");
  const fn = body.slice(0, end);
  assert.match(fn, /escrow\.spendable\(/, "the one reader stopped consulting the ledger");
  assert.match(fn, /readEscrow\(/, "the one reader stopped consulting the chain");
});

test("the settlement adjustment is not reimplemented anywhere else", () => {
  // A second `escrow.spendable(...)` would be a second answer to the same question, free to drift
  // from the first exactly as the raw reads did. One reader, one adjustment, one answer.
  assert.equal(
    (source.match(/escrow\.spendable\(/g) ?? []).length,
    1,
    "the ledger is consulted in more than one place; fold it back into spendableEscrow()",
  );
});

test("each of the three consumers goes through the reader", () => {
  // Named rather than counted: a count breaks on any honest refactor and proves nothing about
  // which caller was fixed. These are the three questions asked of escrow — what to report, what a
  // purchase still needs, and what a top-up adds to.
  for (const [consumer, marker] of [
    ["check_allowance", "async function escrowLine("],
    ["buy", "async function fundEscrow("],
    ["top_up", "const held = await spendableEscrow();\n    const funded = await fundEscrow("],
  ] as const) {
    const at = source.indexOf(marker);
    assert.ok(at > 0, `${consumer}: could not find ${marker}`);
    const body = source.slice(at, at + 900);
    assert.match(body, /spendableEscrow\(/, `${consumer} does not read escrow through the ledger`);
  }
});

/**
 * The refusal a revoke produces, which is the moment this whole project is built around.
 *
 * "Nobody has granted me anything" and "what I was granted has been taken away" are one condition
 * in the code and two different situations for whoever is reading. The connector answered both with
 * setup instructions — the wrong thing to say at the exact moment somebody has deliberately revoked
 * an agent with their face, because it reads as though the revoke never registered.
 *
 * Structural for the same reason the escrow tests above are: `requireMandate` is not exported, and
 * what went wrong was never a function returning the wrong value. It was one message doing the work
 * of two.
 */
test("a withdrawn allowance is not reported as one that never existed", () => {
  const at = source.indexOf("async function requireMandate(");
  assert.ok(at > 0, "requireMandate is gone");
  const body = source.slice(at, at + 1400);

  assert.match(body, /rememberedGranter\(/, "the refusal cannot tell the two cases apart");
  assert.match(body, /withdrawn|revoked/i, "nothing in the refusal says the allowance was taken away");
  assert.match(body, /No allowance yet/, "the never-granted case lost its setup instructions");
});

/**
 * The remembering must not become the answer.
 *
 * Knowing that one account stopped granting says nothing about whether a *different* account has
 * started. An owner who revokes one allowance and immediately grants another would be told the new
 * one does not exist — so the chain is always searched, and the memory only explains a search that
 * found nothing.
 */
test("what is remembered explains a lookup, and never replaces it", () => {
  const at = source.indexOf("async function requireMandate(");
  const body = source.slice(at, at + 1400);

  const lookup = body.indexOf("findGrantingAccount(");
  const memory = body.indexOf("rememberedGranter(");
  assert.ok(lookup > 0 && memory > lookup,
    "the memory is consulted before the chain, which would hide a fresh grant from another account");
});

/**
 * The revoke path, which is the moment this project exists for, and which failed the first time it
 * was ever run against a live chain.
 *
 * A revoked agent looks exactly like an unpaired one to the lookup: the cached account no longer
 * grants, so the search for *some* granting account begins. For an agent nobody has granted
 * anything to, that search walks history, and `chain.ts` has warned about the cost of that in a
 * comment since it was written. Nobody noticed a revoked agent takes the same path.
 *
 * Measured, not guessed: 232,000 blocks in twenty-four windowed `eth_getLogs` calls, which
 * exhausted Arc's public rate limit. The owner revoked an allowance on their phone, the agent was
 * asked to buy a step, and the answer was a viem stack trace with the calldata in it.
 */
test("a revoked agent does not re-read the chain's history looking for its grant", () => {
  const chain = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "chain.ts"), "utf8");

  assert.match(chain, /const revoked = state\.account !== null/,
    "nothing distinguishes a revoked agent from one that was never granted anything");

  const spans = chain.slice(chain.indexOf("const spans"), chain.indexOf("const cover"));
  assert.match(spans, /revoked/, "the search reads the same spans whether or not a grant was revoked");

  // The bound is the whole fix: a known-revoked agent reads a fixed recent stretch rather than
  // everything since it was last looked at, which grows by 167,000 blocks a day.
  assert.match(spans, /head - RECENT/,
    "the revoked branch is unbounded, so it grows with every day the agent is not used");
  assert.match(chain, /const RECENT = LOG_WINDOW \* \d+n/,
    "the recent stretch is not defined in terms of the window it is read in");
});

/**
 * And whatever goes wrong, a person gets a sentence.
 *
 * Arc's endpoint rate-limits. When it did, every tool answered with viem's full dump: calldata, ABI
 * signature, a link to the docs. Reasonable to log, useless to read.
 */
test("an unreachable endpoint is explained, not dumped", () => {
  assert.match(source, /function unreachable\(/, "nothing translates an RPC failure");
  assert.match(source, /rate limit/i, "a rate limit is the failure that actually happens, and is not named");

  const guard = source.slice(source.indexOf("async function requireMandate("), source.indexOf("if (!account)"));
  assert.match(guard, /try \{/, "the lookup is unguarded, so viem's error reaches the person");
  assert.match(guard, /rememberedGranter\(/,
    "a failure discards what is already known, which is still true and still useful");
});
