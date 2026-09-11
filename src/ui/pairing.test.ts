import { test } from "node:test";
import assert from "node:assert/strict";
import { pairingLink } from "../../mcp/pairing.ts";
import { readPairingLink } from "./pairing.ts";

/**
 * What the scanner reads, from the phone's side. The parsing itself is tested beside the connector,
 * in `mcp/pairing.test.ts`; these check that the phone reads what the connector prints.
 */

const AGENT = "0xB8A53c985E437000C4e77300690B00B146D293D2";
const CODE = "0123456789abcdef0123456789abcdef";

test("the code the connector prints reads as its address and its pairing code", () => {
  assert.deepEqual(readPairingLink(pairingLink(AGENT, 5042002, CODE)), { address: AGENT, pairing: CODE });
});

test("whitespace around the code does not defeat it", () => {
  assert.deepEqual(readPairingLink(`  ${pairingLink(AGENT, 5042002, CODE)}\n`), { address: AGENT, pairing: CODE });
});

/** An older connector prints a bare address. It still reads, with no pairing, and the screen says so. */
test("a bare address reads, with no pairing code", () => {
  assert.deepEqual(readPairingLink(AGENT), { address: AGENT, pairing: null });
});

test("anything that is not an agent's code is refused rather than half read", () => {
  for (const scanned of ["https://example.com", "0xnope", `${AGENT}extra`, "", "ethereum:notanaddress"]) {
    assert.equal(readPairingLink(scanned), null, `accepted ${JSON.stringify(scanned)}`);
  }
});
