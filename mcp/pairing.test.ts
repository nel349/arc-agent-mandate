import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toHex } from "viem";
import { isPairingCode, pairingLink, pairingTag, readPairingLink } from "./pairing.ts";

const AGENT = "0xB8A53c985E437000C4e77300690B00B146D293D2";
const CODE = "0123456789abcdef0123456789abcdef";

/**
 * The phone computes this tag and the connector searches for it. If the two ever computed it
 * differently, every grant would be ignored, and nothing would say why.
 */
test("a code has one tag, the same every time and different for every code", () => {
  assert.equal(pairingTag(CODE), pairingTag(CODE));
  assert.notEqual(pairingTag(CODE), pairingTag("fedcba9876543210fedcba9876543210"));
  assert.match(pairingTag(CODE), /^0x[0-9a-f]{64}$/);
});

/** The app's other tag is a hash of a label. A pairing tag must never equal one. */
test("a pairing tag cannot be mistaken for a label tag", () => {
  for (const label of ["agent", "mandate", CODE]) {
    assert.notEqual(pairingTag(CODE), keccak256(toHex(label)));
  }
});

test("only a real code has a tag", () => {
  assert.throws(() => pairingTag("not a code"), /32 lowercase hex/);
  assert.throws(() => pairingTag(CODE.toUpperCase()), /32 lowercase hex/);
  assert.equal(isPairingCode(CODE), true);
  assert.equal(isPairingCode(CODE.slice(1)), false);
});

test("the link the agent shows reads back as its address and its code", () => {
  const link = pairingLink(AGENT, 5042002, CODE);
  assert.equal(link, `ethereum:${AGENT}@5042002?pairing=${CODE}`);
  assert.deepEqual(readPairingLink(link), { address: AGENT, pairing: CODE });
});

/** Older connectors print a bare address, and other wallets print plain links. Both still read. */
test("a code with no pairing reads as an address with no pairing", () => {
  assert.deepEqual(readPairingLink(AGENT), { address: AGENT, pairing: null });
  assert.deepEqual(readPairingLink(`ethereum:${AGENT}@5042002`), { address: AGENT, pairing: null });
  assert.deepEqual(readPairingLink(`ethereum:pay-${AGENT}?value=1`), { address: AGENT, pairing: null });
});

test("the code is found among other parameters, in any case", () => {
  assert.deepEqual(
    readPairingLink(`ethereum:${AGENT}@5042002?value=0&pairing=${CODE.toUpperCase()}`),
    { address: AGENT, pairing: CODE },
  );
});

/**
 * Read as "no pairing", a damaged code would lead to a grant the agent ignores. Refused, the person
 * is told the code did not read and scans again.
 */
test("a link with a damaged code is refused whole", () => {
  assert.equal(readPairingLink(`ethereum:${AGENT}@5042002?pairing=${CODE.slice(2)}`), null);
  assert.equal(readPairingLink(`ethereum:${AGENT}@5042002?pairing=`), null);
});

test("anything that is not an agent's code is refused rather than half read", () => {
  for (const scanned of ["https://example.com", "0xnope", `${AGENT}extra`, "0x", "", "ethereum:notanaddress"]) {
    assert.equal(readPairingLink(scanned), null, `accepted ${JSON.stringify(scanned)}`);
  }
});
