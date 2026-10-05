import { test } from "node:test";
import assert from "node:assert/strict";
import { stepAfter } from "./grant-steps.ts";

const NOTHING = { limit: false, days: false, changing: false } as const;

test("a code carrying its app's whole request goes from the scan straight to the card", () => {
  assert.equal(stepAfter("agent", { limit: true, days: true, changing: false }), "card");
});

test("whatever the code left out is asked, in order, and nothing it answered is asked again", () => {
  assert.equal(stepAfter("agent", NOTHING), "amount");
  assert.equal(stepAfter("amount", NOTHING), "window");
  assert.equal(stepAfter("window", NOTHING), "card");
  // a code that named the limit but not the length asks only the length
  assert.equal(stepAfter("agent", { limit: true, days: false, changing: false }), "window");
  // and one that named the length but not the limit asks only the limit
  assert.equal(stepAfter("agent", { limit: false, days: true, changing: false }), "amount");
  assert.equal(stepAfter("amount", { limit: true, days: true, changing: false }), "card");
});

test("changing one line from the card goes back to the card, not through the questions after it", () => {
  assert.equal(stepAfter("amount", { limit: true, days: false, changing: true }), "card");
  assert.equal(stepAfter("window", { limit: true, days: true, changing: true }), "card");
});
