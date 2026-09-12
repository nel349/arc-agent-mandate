import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress, isAddress } from "viem";
import { ARC_CONTRACTS, explorerTokenUrl, explorerTxUrl, MAZE_URL } from "./chain.ts";

/**
 * The addresses this app builds on, checked against their own checksums.
 *
 * An address whose checksum does not match is refused by viem at the call site, not at build time,
 * so a hand-typed one reaches a person as a failed read rather than as a mistake anybody could see.
 * That is exactly how the badge contract arrived here: typed out with the wrong capitals, and the
 * only symptom was "Address is invalid" from a screen that should have shown a badge.
 */

/** Every address in the record, whatever nesting it sits under, named by where it was found. */
function addressesIn(record: object, path = ""): [string, string][] {
  return Object.entries(record).flatMap(([key, value]) => {
    const where = path === "" ? key : `${path}.${key}`;
    if (typeof value === "string") return [[where, value] as [string, string]];
    return typeof value === "object" && value !== null ? addressesIn(value, where) : [];
  });
}

test("every Arc address is an address, and is written the way its checksum says", () => {
  const found = addressesIn(ARC_CONTRACTS);
  assert.ok(found.length >= 8, `only ${found.length} addresses were found; the record moved`);
  for (const [where, address] of found) {
    assert.ok(isAddress(address, { strict: false }), `${where} is not an address: ${address}`);
    assert.equal(address, getAddress(address), `${where} does not match its checksum`);
  }
});

test("a badge and a transaction each link to where anybody can check them", () => {
  assert.equal(
    explorerTokenUrl(2),
    `https://testnet.arcscan.app/token/${ARC_CONTRACTS.cohortBadge}/instance/2`,
  );
  assert.equal(
    explorerTxUrl("0x431dafcff477613fe8e08adf74883319deddfde33fae6fb055be9dc0cca739a8"),
    "https://testnet.arcscan.app/tx/0x431dafcff477613fe8e08adf74883319deddfde33fae6fb055be9dc0cca739a8",
  );
});

test("the maze's address is one a badge's own metadata can be fetched from, with no trailing slash", () => {
  assert.equal(MAZE_URL, "https://arc-maze.vercel.app");
  assert.doesNotMatch(MAZE_URL, /\/$/, "a trailing slash would double up when a path is appended");
});
