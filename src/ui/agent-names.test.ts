import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agentNameOf, cleanAgentName, MAX_AGENT_NAME, NO_NAMES, parseAgentNames, withAgentName,
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
