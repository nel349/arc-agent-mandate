import { test } from "node:test";
import assert from "node:assert/strict";
import { pairedAddress } from "./pairing.ts";

const AGENT = "0xB8A53c985E437000C4e77300690B00B146D293D2";

test("a bare address is what the connector prints, and is accepted", () => {
  assert.equal(pairedAddress(AGENT), AGENT);
});

test("whitespace around the code does not defeat it", () => {
  assert.equal(pairedAddress(`  ${AGENT}\n`), AGENT);
});

/** What a wallet elsewhere would encode. Refusing it would be pedantic when the address is right there. */
test("an ethereum: URI is unwrapped", () => {
  assert.equal(pairedAddress(`ethereum:${AGENT}`), AGENT);
  assert.equal(pairedAddress(`ethereum:${AGENT}@5042002`), AGENT);
  assert.equal(pairedAddress(`ethereum:pay-${AGENT}?value=1`), AGENT);
});

test("anything that is not an address is refused rather than half-read", () => {
  for (const scanned of [
    "https://example.com",
    "0xnope",
    `${AGENT}extra`,
    "0x",
    "",
    "ethereum:notanaddress",
  ]) {
    assert.equal(pairedAddress(scanned), null, `accepted ${JSON.stringify(scanned)}`);
  }
});
