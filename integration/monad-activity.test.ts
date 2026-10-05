import { test } from "node:test";
import assert from "node:assert/strict";
import { MONAD_TESTNET } from "@kuiralabs/mandate-core";
import { readActivityWindow } from "../src/arc/activity.ts";

/**
 * Does the feed read what an agent did on Monad the way the phone will, where a payment in MON leaves
 * no log of its own?
 *
 * Against the live chain, at the connector's proof on 3 Oct (scripts/prove-connector-monad.ts): the
 * wallet granted an agent, the agent paid 0.002 MON through the connector, and a second agent set up
 * its ERC-8004 identity, number 1997, owned by the wallet. If Circle's bundler stops calling the
 * EntryPoint directly, or the plugin's call shape changes, this is where it shows.
 */

const WALLET = "0xB0D5AB6792a6abdF22d35e02F6525ae13Afd8e55";
const PAYER = "0x806dC09Fc68509E77B5909f88f2A934b3D2852E5";
const PAYEE = "0x9C1a07dCf5B8c1Da6025d84754Bb3a7d3345f281";
const REGISTRAR = "0x948c0177445FE0F9998b989529171Bf08D834E0A";
const GRANTED_AT = 68_026_785n;
const PAID_AT = 68_026_961n;
const PAID_IN = "0x3171bcea1d331bcdac3117679190eab2fa7e334502b88d4362353028341765be";
const REGISTERED_AT = 68_027_775n;

const around = (block: bigint) => readActivityWindow(WALLET, { from: block - 50n, to: block + 50n }, undefined, MONAD_TESTNET);

test("an agent's payment in MON reads back from its operation, with who was paid and how much", async () => {
  const found = await around(PAID_AT);
  const paid = found.find((item) => item.kind === "paid");
  assert.ok(paid, `expected the payment in ${PAID_IN}, found ${found.map((item) => item.kind).join(", ") || "nothing"}`);
  assert.equal(paid.tx, PAID_IN);
  assert.equal(paid.agent, PAYER);
  assert.equal(paid.to, PAYEE);
  assert.equal(paid.amount?.format(3), "0.002");
  assert.equal(paid.block, PAID_AT);
  assert.ok(paid.at > 1_790_000_000, "the time comes from the block");
});

test("the grant that let it pay reads back, and the owner's own operation is credited to no agent", async () => {
  const found = await around(GRANTED_AT);
  assert.deepEqual(found.map((item) => [item.kind, item.agent]), [["granted", PAYER]]);
});

test("an agent setting up its identity reads back with the number it was given", async () => {
  const found = await around(REGISTERED_AT);
  const registered = found.find((item) => item.kind === "registered");
  assert.ok(registered);
  assert.equal(registered.identity, 1997n);
  assert.equal(registered.agent, REGISTRAR);
});

test("a wallet that did nothing reads back nothing", async () => {
  assert.deepEqual(await readActivityWindow("0x000000000000000000000000000000000000dEaD", { from: PAID_AT - 50n, to: PAID_AT + 50n }, undefined, MONAD_TESTNET), []);
});
