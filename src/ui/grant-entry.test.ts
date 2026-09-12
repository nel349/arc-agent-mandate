import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, keccak256, parseAbi, toHex } from "viem";
import { pairingLink, pairingTag } from "../../mcp/pairing.ts";
import { buildGrantPlan } from "../arc/mandate.ts";
import { Usdc } from "../arc/usdc.ts";
import {
  alreadyGranted, entryFromScan, entryFromText, GRANT_LABEL, grantedWithoutCode, mandateTermsFor,
} from "./grant-entry.ts";
import { GRANT_PROBLEMS, readGrantTerms } from "./grant-terms.ts";
import { readPairingLink } from "./pairing.ts";

/**
 * The path a pairing code takes on the phone, from the moment the agent is entered to the tag the
 * grant writes on chain.
 *
 * On 09-10 a grant made after scanning carried the label instead of the code, and the agent rightly
 * ignored it. Every step of this path was tested except the path itself, so these follow the code
 * from the entry, through the terms, into the grant's calldata.
 */

const AGENT = "0x3535816e967Ad2B6271dfadf9138fb07eAB161Ce";
const CODE = "60c3b7c8b77d90e505185d4b5f9aae71";
const LINK = pairingLink(AGENT, 5042002, CODE);
/** A fixed moment, so the expiry is an exact number rather than a range. */
const NOW_MS = 1_789_700_000_000;
const addSessionKey = parseAbi(["function addSessionKey(address sessionKey, bytes32 tag, bytes[] permissionUpdates)"]);

/** The form's reading of an entry, as the screen makes it. */
function termsOf(agent: string) {
  const read = readGrantTerms({ agent, amount: "5", days: "7" });
  if (!("terms" in read)) throw new Error(`the form refused ${agent}: ${JSON.stringify(read.problems)}`);
  return read.terms;
}

/** The tag the grant would write, read back out of the calldata it builds. */
function tagOf(pairing: string | null, agent: string): string {
  const { management } = buildGrantPlan(mandateTermsFor(termsOf(agent), pairing, NOW_MS), true);
  return decodeFunctionData({ abi: addSessionKey, data: management }).args[1];
}

test("a scanned code carries its pairing code all the way into the grant's tag", () => {
  const scanned = readPairingLink(LINK);
  if (scanned === null) throw new Error("the scanner could not read the connector's own link");
  const entry = entryFromScan(scanned);
  assert.deepEqual(entry, { agent: AGENT, pairing: CODE });

  const terms = mandateTermsFor(termsOf(entry.agent), entry.pairing, NOW_MS);
  assert.equal(terms.agent, AGENT);
  assert.equal(terms.limit.toString(), Usdc.parse("5").toString());
  assert.deepEqual(terms.payees, []);
  assert.equal(terms.expiresAt, NOW_MS / 1000 + 7 * 86_400);
  assert.equal(terms.label, GRANT_LABEL);
  assert.equal(terms.pairing, CODE, "the code changed on its way into the terms");

  assert.equal(tagOf(entry.pairing, entry.agent), pairingTag(CODE));
});

test("a pasted link carries the code exactly as a scan does, spaces and all", () => {
  const entry = entryFromText(`  ${LINK}\n`);
  assert.deepEqual(entry, { agent: AGENT, pairing: CODE });
  assert.equal(tagOf(entry.pairing, entry.agent), pairingTag(CODE));
});

test("a typed address carries no code, and the grant is labelled instead", () => {
  const entry = entryFromText(AGENT);
  assert.deepEqual(entry, { agent: AGENT, pairing: null });

  const terms = mandateTermsFor(termsOf(entry.agent), entry.pairing, NOW_MS);
  assert.equal("pairing" in terms, false, "a grant with no code claimed to carry one");
  assert.equal(tagOf(entry.pairing, entry.agent), keccak256(toHex(GRANT_LABEL)));
});

/**
 * A link whose code is damaged is not quietly read as having none: that would grant an allowance the
 * agent ignores. It is kept as typed, so the field says it is not an address and nothing is granted.
 */
test("a link with a damaged code is refused rather than granted without one", () => {
  const damaged = `ethereum:${AGENT}@5042002?pairing=not-a-code`;
  const entry = entryFromText(damaged);
  assert.deepEqual(entry, { agent: damaged, pairing: null });

  const read = readGrantTerms({ agent: entry.agent, amount: "5", days: "7" });
  assert.ok("problems" in read, "a damaged link reached a grant");
  assert.equal(read.problems.agent, GRANT_PROBLEMS.agent);
});

test("a code that is not one is refused when the terms are made", () => {
  assert.throws(() => mandateTermsFor(termsOf(AGENT), "ABC", NOW_MS), /32 lowercase hex/);
  assert.throws(() => mandateTermsFor(termsOf(AGENT), CODE.toUpperCase(), NOW_MS), /32 lowercase hex/);
});

/**
 * On screen, an allowance the agent will never use looked exactly like one it spends from. The tag
 * the grant wrote is what tells them apart, and the feed now keeps it.
 */
test("a grant's tag says whether the connector will use the allowance, and an unread tag says nothing", () => {
  assert.equal(grantedWithoutCode(pairingTag(CODE)), false, "a scanned grant carries the agent's code");
  assert.equal(grantedWithoutCode(keccak256(toHex(GRANT_LABEL))), true);
  assert.equal(grantedWithoutCode(keccak256(toHex(GRANT_LABEL)).toUpperCase().replace("0X", "0x")), true);
  // The SDK's default label, from before the app sent one of its own.
  assert.equal(grantedWithoutCode(keccak256(toHex("mandate"))), true);
  assert.equal(grantedWithoutCode(undefined), false, "a row read before tags were kept is not a claim");
});

/**
 * The plugin allows one allowance per agent per wallet, and refused a second only after Face ID. The
 * first step sees it instead, from the allowances already read.
 */
test("an agent this wallet already grants is caught at the first step, whatever the address's case", () => {
  const live = [{ agent: AGENT as `0x${string}` }];
  assert.equal(alreadyGranted(AGENT.toLowerCase(), live), true);
  assert.equal(alreadyGranted("0x2222222222222222222222222222222222222222", live), false);
  assert.equal(alreadyGranted("", live), false);
  assert.equal(alreadyGranted(AGENT, []), false);
});

test("editing the field back to a bare address drops the code, and only then", () => {
  assert.equal(entryFromText(LINK).pairing, CODE);
  assert.equal(entryFromText(AGENT).pairing, null);
  assert.equal(entryFromText("").pairing, null);
});
