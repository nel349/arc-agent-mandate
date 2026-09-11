import { test } from "node:test";
import assert from "node:assert/strict";
import { readActivityWindow } from "../src/arc/activity.ts";

/**
 * Does the payments feed read a real purchase off Arc the way the phone will?
 *
 * Against the live chain, at one known moment: on 09-10 at 19:10 UTC our agent bought a step on the
 * maze, and the account funded it with a 0.001 USDC deposit into the agent's Gateway balance. The
 * feed's whole claim is that this shows on Arc as Gateway's `Deposited` event, naming the agent and
 * the account, with the block's time on the log. If Gateway ever renames the event, moves the
 * indexed arguments, or the node stops putting times on logs, this is where it shows.
 *
 * Checked by hand on ArcScan at the time: transaction 0xa358…d6d3, block 61,444,111.
 */

const ACCOUNT = "0xc3BB7bc7E375f7ffA34E652F560Dc802F7A76cFa";
const AGENT = "0x3535816e967Ad2B6271dfadf9138fb07eAB161Ce";
const BLOCK = 61_444_111n;
const TX = "0xa358110f8d264214723dd48a578bd84e6fe0880eedf7600861be58130069d6d3";

test("a purchase funded on 09-10 reads back as a draw by our agent", async () => {
  const found = await readActivityWindow(ACCOUNT, { from: BLOCK - 5n, to: BLOCK + 5n });
  const draw = found.find((item) => item.tx === TX);

  assert.ok(draw, `expected the deposit in ${TX}, found ${found.length} rows`);
  assert.equal(draw.kind, "draw");
  assert.equal(draw.agent.toLowerCase(), AGENT.toLowerCase());
  assert.equal(draw.amount?.format(6), "0.001000");
  assert.equal(draw.block, BLOCK);
  // 2026-09-10 19:10:22 UTC, from the block itself.
  assert.equal(draw.at, 1_789_067_422);
});

/**
 * Grants and revokes come back from one query asking for either event, which viem's typed call
 * cannot express, so it goes through the raw one. Both of these are on ArcScan under the plugin's
 * logs for our account: the grant before the 09-10 maze run, and the revoke after it.
 */
test("one query finds both a grant and a revoke, and says which is which", async () => {
  const GRANTED_AT = 61_331_599n;
  const REVOKED_AT = 61_462_815n;
  const [granted, revoked] = await Promise.all([
    readActivityWindow(ACCOUNT, { from: GRANTED_AT - 5n, to: GRANTED_AT + 5n }),
    readActivityWindow(ACCOUNT, { from: REVOKED_AT - 5n, to: REVOKED_AT + 5n }),
  ]);

  const grant = granted.find((item) => item.kind === "granted");
  assert.ok(grant, `expected a grant near ${GRANTED_AT}, found ${granted.map((i) => i.kind).join(", ") || "nothing"}`);
  assert.equal(grant.block, GRANTED_AT);
  assert.ok(grant.at > 0);

  const revoke = revoked.find((item) => item.kind === "revoked");
  assert.ok(revoke, `expected a revoke near ${REVOKED_AT}, found ${revoked.map((i) => i.kind).join(", ") || "nothing"}`);
  assert.equal(revoke.block, REVOKED_AT);
  // The agent that was revoked on 09-10, ending 61Ce.
  assert.equal(revoke.agent.toLowerCase(), AGENT.toLowerCase());
});

test("an account that never funded anything has no draws in the same window", async () => {
  const found = await readActivityWindow("0x000000000000000000000000000000000000dEaD", { from: BLOCK - 5n, to: BLOCK + 5n });
  assert.equal(found.length, 0);
});
