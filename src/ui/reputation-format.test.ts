import { test } from "node:test";
import assert from "node:assert/strict";
import type { Feedback } from "../arc/reputation.ts";
import { scoreLabel, scoreMeaning, scoreOf, writtenBy } from "./reputation-format.ts";

const said = (over: Partial<Feedback> = {}): Feedback => ({
  client: "0x2B853e07219205B2952a39b720a169b71ffe3C30",
  value: 100,
  decimals: 0,
  tag1: "arc-maze",
  tag2: "efficiency-pct",
  ...over,
});

test("a score is read in the units its writer recorded", () => {
  assert.equal(scoreLabel(said()), "100% efficiency");
  assert.equal(scoreOf(said({ value: 875, decimals: 1 })), 87.5);
  assert.equal(scoreLabel(said({ value: 875, decimals: 1 })), "87.5% efficiency");
});

test("units we cannot speak for are shown as the bare figure, never explained wrongly", () => {
  const other = said({ tag2: "laps" });
  assert.equal(scoreLabel(other), "100");
  assert.equal(scoreMeaning(other), null);
});

/**
 * Steps and cost are both better when lower, so "100" beside a maze is ambiguous to anyone who has
 * not read the tag. Saying which way the scale runs is the difference between a figure and a fact.
 */
test("the scale says which way it runs", () => {
  assert.equal(scoreMeaning(said()), "The shortest route there is.");
  assert.match(scoreMeaning(said({ value: 62 })) ?? "", /Higher is better/);
});

test("who wrote it is named, because an agent cannot write its own", () => {
  assert.match(writtenBy(said()), /arc-maze/);
  // An untagged writer is still named, by address rather than by nothing.
  assert.match(writtenBy(said({ tag1: "" })), /0x2B853e07/);
});
