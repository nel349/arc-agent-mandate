import { test } from "node:test";
import assert from "node:assert/strict";
import type { Activity } from "../arc/activity.ts";
import {
  agentNameOf, allowanceKey, allowanceName, cleanAgentName, grantAt, grantsIn, MAX_AGENT_NAME, NO_NAMES,
  parseAgentNames, withAgentName, withNewAllowance, type Grant,
} from "./agent-names.ts";

const AGENT = "0x68c91fb4F4e7f0236fd68c7d2605b5740787B17e";

test("a name is trimmed, its inner spaces collapsed, and capped", () => {
  assert.equal(cleanAgentName("  Maze   runner \n"), "Maze runner");
  assert.equal(cleanAgentName("x".repeat(MAX_AGENT_NAME + 10)).length, MAX_AGENT_NAME);
  assert.equal(cleanAgentName("   "), "");
});

test("nothing stored, or something unreadable, is no names rather than a crash", () => {
  assert.deepEqual(parseAgentNames(null), NO_NAMES);
  assert.deepEqual(parseAgentNames("{not json"), NO_NAMES);
  assert.deepEqual(parseAgentNames("[\"a\"]"), NO_NAMES);
  assert.deepEqual(parseAgentNames("\"a string\""), NO_NAMES);
});

test("a stored record keeps only real names, keyed by lowercased address", () => {
  const names = parseAgentNames(JSON.stringify({ [AGENT]: " Maze runner ", "0xabc": 7, "0xdef": "  " }));
  assert.deepEqual(names, { [AGENT.toLowerCase()]: "Maze runner" });
});

test("naming an agent returns a new record and leaves the old one alone", () => {
  const before = NO_NAMES;
  const after = withAgentName(before, AGENT, "Maze runner");
  assert.equal(agentNameOf(after, AGENT), "Maze runner");
  assert.equal(agentNameOf(before, AGENT), null);
});

test("a blank name removes the agent's name", () => {
  const named = withAgentName(NO_NAMES, AGENT, "Maze runner");
  assert.equal(agentNameOf(withAgentName(named, AGENT, "  "), AGENT), null);
});

test("an address finds its name whatever its case", () => {
  const named = withAgentName(NO_NAMES, AGENT.toUpperCase().replace("0X", "0x"), "Maze runner");
  assert.equal(agentNameOf(named, AGENT.toLowerCase()), "Maze runner");
});

// ---- one name per allowance ------------------------------------------------

/**
 * The bug these exist for: one agent granted nine times from two wallets, and a new name given to the
 * ninth showed on every row of the other eight, because names belonged to the agent's address.
 */
const TX_A = "0xAAAA000000000000000000000000000000000000000000000000000000000001";
const TX_B = "0xBBBB000000000000000000000000000000000000000000000000000000000002";
const TX_DRAW = "0xCCCC000000000000000000000000000000000000000000000000000000000003";

const row = (kind: Activity["kind"], tx: string, block: bigint, logIndex: number): Activity => ({
  kind, agent: AGENT as `0x${string}`, amount: null, at: 1_757_600_000, block, tx: tx as `0x${string}`, logIndex,
});

const FIRST: Grant = { agent: AGENT.toLowerCase(), block: 100n, logIndex: 4, key: allowanceKey(TX_A, 4) };
const SECOND: Grant = { agent: AGENT.toLowerCase(), block: 200n, logIndex: 1, key: allowanceKey(TX_B, 1) };

test("an allowance's key is its grant's log, the same whatever the hash's case", () => {
  assert.equal(allowanceKey(TX_A, 4), `${TX_A.toLowerCase()}:4`);
  assert.equal(allowanceKey(TX_A.toLowerCase(), 4), allowanceKey(TX_A, 4));
});

test("the feed's grants are read as the allowances they started, and nothing else is", () => {
  const items = [row("granted", TX_B, 200n, 1), row("draw", TX_DRAW, 150n, 0), row("granted", TX_A, 100n, 4)];
  assert.deepEqual(grantsIn(items), [SECOND, FIRST]);
});

test("a row belongs to the agent's latest grant at or before it, by block and then by place", () => {
  const grants = [SECOND, FIRST];
  assert.equal(grantAt(AGENT, { block: 150n, logIndex: 0 }, grants), FIRST);
  assert.equal(grantAt(AGENT, { block: 200n, logIndex: 1 }, grants), SECOND, "a grant is its own row's allowance");
  assert.equal(grantAt(AGENT, { block: 200n, logIndex: 0 }, grants), FIRST, "earlier in the same block");
  assert.equal(grantAt(AGENT, { block: 99n, logIndex: 9 }, grants), null, "older than any grant read");
  assert.equal(grantAt(AGENT, null, grants), SECOND, "with no point given, the current allowance");
  assert.equal(grantAt("0x2222222222222222222222222222222222222222", null, grants), null);
});

test("each allowance shows its own name, and never one given to a later grant", () => {
  const names = { [FIRST.key]: "Maze runner", [SECOND.key]: "Filings buyer" };
  assert.equal(allowanceName(names, AGENT, FIRST, SECOND), "Maze runner");
  assert.equal(allowanceName(names, AGENT, SECOND, SECOND), "Filings buyer");
  assert.equal(allowanceName({ [SECOND.key]: "Filings buyer" }, AGENT, FIRST, SECOND), null);
});

test("a name kept by address belongs to the current allowance only", () => {
  const names = { [AGENT.toLowerCase()]: "Old name" };
  assert.equal(allowanceName(names, AGENT, SECOND, SECOND), "Old name", "the current allowance keeps it");
  assert.equal(allowanceName(names, AGENT, FIRST, SECOND), null, "an older allowance does not borrow it");
  assert.equal(allowanceName(names, AGENT, null, SECOND), null, "nor does a row older than every grant read");
  assert.equal(allowanceName(names, AGENT, null, null), "Old name", "with no grant read, the agent is its current allowance");
});

test("a new allowance takes only its own name, and the one before keeps the name it had", () => {
  const before = { [AGENT.toLowerCase()]: "Maze runner" };
  const after = withNewAllowance(before, AGENT, { tx: TX_B, logIndex: 1 }, FIRST, "Filings buyer");
  assert.deepEqual(after, { [FIRST.key]: "Maze runner", [SECOND.key]: "Filings buyer" });
  assert.equal(allowanceName(after, AGENT, FIRST, SECOND), "Maze runner");
  assert.equal(allowanceName(after, AGENT, SECOND, SECOND), "Filings buyer");
});

test("a new allowance granted without a name shows its address, not the last one's name", () => {
  const after = withNewAllowance({ [AGENT.toLowerCase()]: "Maze runner" }, AGENT, { tx: TX_B, logIndex: 1 }, FIRST, "  ");
  assert.deepEqual(after, { [FIRST.key]: "Maze runner" });
  assert.equal(allowanceName(after, AGENT, SECOND, SECOND), null);
});

test("without the new grant's log, its name is kept by address, which the current allowance reads", () => {
  const after = withNewAllowance(NO_NAMES, AGENT, null, null, "Maze runner");
  assert.deepEqual(after, { [AGENT.toLowerCase()]: "Maze runner" });
});
