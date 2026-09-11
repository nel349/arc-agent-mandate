import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address } from "viem";

/**
 * What the connector answers from its own memory, without asking the chain.
 *
 * Which grant counts is decided against a real chain, in `integration/pairing.test.ts`, on a fork of
 * Arc with the real plugin, the real Circle account and real strangers. What is left here is what the
 * connector must say from what it remembers alone. The endpoint is a port nothing listens on, so a
 * test that reached for the chain would fail rather than pass by accident.
 */

delete process.env["ARC_ACCOUNT"];
process.env["ARC_RPC_URL"] = "http://127.0.0.1:9";

const AGENT = "0x000000000000000000000000000000000000dEaD" as Address;
const OWNER = "0xEe1933BbBC8acd7B32caD469D4f22Ca5B19d7918" as Address;
const OTHER = "0xc3BB7bc7E375f7ffA34E652F560Dc802F7A76cFa" as Address;
const CODE = "0123456789abcdef0123456789abcdef";

/** A state file of its own per test, so none of them can see another's. */
function statePath(contents?: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), "arc-mandate-")), "accounts.json");
  process.env["ARC_MANDATE_ACCOUNT_PATH"] = path;
  if (contents !== undefined) writeFileSync(path, JSON.stringify(contents));
  return path;
}

/** A fresh copy of the module, so the state path each test sets is the one it reads. */
const load = (why: string) =>
  import(`./chain.ts?${why}=${Date.now()}-${Math.random()}`) as Promise<typeof import("./chain.ts")>;

test("an agent that has never shown a code has no grant, and does not ask the chain for one", async () => {
  statePath({});
  const { findGrant } = await load("never");
  assert.deepEqual(await findGrant(AGENT), { status: "unpaired", legacy: null });
});

/**
 * The wallet the connector remembered before grants carried a code. Its allowance may be live, but
 * nothing ties it to this agent's owner, so it is not spent from; the owner scans the new code once.
 */
test("a wallet remembered from before pairing codes is not spent from", async () => {
  statePath({ [AGENT.toLowerCase()]: { account: OTHER, searched: { low: "60625268", high: "61477649" } } });
  const { findGrant, rememberedGranter } = await load("legacy");
  assert.deepEqual(await findGrant(AGENT), { status: "unpaired", legacy: OTHER });
  assert.equal(rememberedGranter(AGENT), OTHER);
});

/**
 * Telling "never granted" apart from "taken away".
 *
 * Both are the same absence in the code and completely different sentences to a person. The
 * remembered wallet is what tells them apart when the chain cannot be asked.
 */
test("the wallet an agent was paired with is remembered after it stops granting", async () => {
  statePath({ [AGENT.toLowerCase()]: { account: OWNER, accountCode: CODE } });
  const { rememberedGranter } = await load("remembered");
  assert.equal(rememberedGranter(AGENT), OWNER);
});

test("an agent nobody ever granted anything to remembers nobody", async () => {
  statePath({});
  const { rememberedGranter } = await load("forgotten");
  assert.equal(rememberedGranter(AGENT), null);
});

/** The oldest file format stored a bare address. An upgrade must not lose it. */
test("a wallet remembered in the oldest format is still remembered", async () => {
  statePath({ [AGENT.toLowerCase()]: OTHER });
  const { rememberedGranter } = await load("oldest");
  assert.equal(rememberedGranter(AGENT), OTHER);
});

/** A missing or unreadable state file is an ordinary state, not a failure. */
test("no state file at all is answered rather than thrown at", async () => {
  process.env["ARC_MANDATE_ACCOUNT_PATH"] = join(mkdtempSync(join(tmpdir(), "arc-mandate-")), "absent.json");
  const { rememberedGranter } = await load("absent");
  assert.equal(rememberedGranter(AGENT), null);
});
